/* =====================================================================
   Synthetischer Sound (Reihensechser, Reifenquietschen, Fehlzündungen)
   komplett per WebAudio – keine Audiodateien nötig
   ===================================================================== */
(function () {
  'use strict';

  // ---------- Motor als Echtzeit-Simulation (AudioWorklet) ----------
  // Jede Zündung der 6 Zylinder erzeugt einen Druckstoß, der durch Krümmer und
  // Auspuffrohr (Wellenleiter mit Reflexion) läuft. Dazu Ansaugrauschen.
  const WORKLET_SRC = `
class EngineProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
    { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
  ]; }
  constructor() {
    super();
    this.sr = sampleRate; this.phase = 0; this.cyl = 6;
    this.camp = [1.0, 0.86, 0.95, 0.82, 1.03, 0.9];
    this.coff = [0, 0.004, -0.003, 0.006, -0.002, 0.003];
    this.pt = new Float32Array(6).fill(1e9); this.pa = new Float32Array(6);
    this.dl = new Float32Array(8192); this.di = 0;
    this.hl = new Float32Array(2048); this.hi = 0;
    this.lpS = 0; this.hpX = 0; this.hpY = 0; this.prevY = 0; this.seed = 1234567;
    this.bx1 = 0; this.bx2 = 0; this.by1 = 0; this.by2 = 0;
    this.rpmS = 900; this.loadS = 0; this.wob = 0; this.two = false; this.miss = 0;
    this.c = { pipe: 0.0105, refl: 0.6, header: 0.0028, hrefl: 0.35, noise: 0.35, intake: 0.5, damp: 0.45, gain: 0.4, rasp: 0.4, tick: 0, crackle: 0.07 };
    this.port.onmessage = (e) => {
      Object.assign(this.c, e.data);
      // ungleichmäßige Zylinder = Blubbern / Grollen, gleichmäßige = seidiger Reihensechser
      // nur komplette Motorprofile (mit Rohrlänge) setzen Zylinderzahl/Takt – einzelne Werte wie 'crackle' nicht
      if (e.data.pipe != null) {
        this.cyl = e.data.cyl || 6;   // Zylinderzahl (Traktor: 4, Moped: 1)
        this.two = !!e.data.two;      // Zweitakter: Zündung bei jeder Umdrehung
      }
      if (e.data.camp) this.camp = e.data.camp.slice();
      if (e.data.coff) this.coff = e.data.coff.slice();
    };
  }
  rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return (this.seed / 4294967296) * 2 - 1; }
  process(inputs, outputs, params) {
    const out = outputs[0][0]; if (!out) return true;
    const n = out.length, sr = this.sr, c = this.c;
    const rpmT = params.rpm[0], loadT = params.load[0], cut = params.cut[0] > 0.5;
    const fI = Math.min(5000, 260 + rpmT * 0.13), Q = 2.0;
    const w0 = 2 * Math.PI * fI / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
    const L = Math.max(2, Math.min(8000, Math.round(c.pipe * sr)));
    const HL = Math.max(2, Math.min(2000, Math.round(c.header * sr)));
    const raspK = sr / 1500;
    for (let i = 0; i < n; i++) {
      this.rpmS += (rpmT - this.rpmS) * 0.002;
      this.loadS += (loadT - this.loadS) * 0.003;
      this.wob = this.wob * 0.9995 + 0.00002 * this.rnd();
      const rpm = Math.max(300, this.rpmS * (1 + this.wob + (this.rpmS < 1300 ? 0.012 * Math.sin(this.phase * 18.85) : 0)));
      const cyc = rpm / (this.two ? 60 : 120);
      const prev = this.phase; this.phase += cyc / sr; if (this.phase >= 1) this.phase -= 1;
      const plen = Math.max(c.pmin || 0.0012, (c.pw || 0.55) / (cyc * this.cyl));
      for (let k = 0; k < this.cyl; k++) {
        let f = k / this.cyl + this.coff[k]; f -= Math.floor(f);
        const crossed = prev <= this.phase ? (prev < f && this.phase >= f) : (prev < f || this.phase >= f);
        if (crossed) {
          const ld = this.loadS;
          let a = this.camp[k] * (0.26 + 0.74 * ld) * (0.9 + 0.2 * Math.random());
          if (cut) a *= 0.07;
          else if (this.two) {
            // Zweitakter im Teillast/Leerlauf: setzt immer wieder aus ("Ring-Ding-Ding"),
            // nach einem Aussetzer zündet die volle Ladung umso kräftiger
            const pm = (c.skip || 0) * Math.max(0, 1 - ld * 2.2);
            if (Math.random() < pm) { a *= 0.1; this.miss = 1; }
            else if (this.miss) { a *= 1.35; this.miss = 0; }
          }
          else if (ld < 0.06 && rpm > 2600 && Math.random() < c.crackle) a *= 2.0 + c.crackle * 4;
          this.pt[k] = 0; this.pa[k] = a;
        }
      }
      let e = 0, tick = 0;
      for (let k = 0; k < this.cyl; k++) {
        const t = this.pt[k];
        if (t < plen * 2.2) {
          const x = t / plen;
          const p = x < 1 ? 0.5 - 0.5 * Math.cos(6.283185 * x) : -0.22 * Math.sin(3.14159 * (x - 1) / 1.2) * Math.exp(-(x - 1) * 1.5);
          e += this.pa[k] * p * (1 + c.noise * (0.5 + this.loadS) * this.rnd());
          if (t < 0.0009) tick += this.pa[k] * this.rnd() * (1 - t / 0.0009);
          this.pt[k] = t + 1 / sr;
        }
      }
      const hOut = this.hl[(this.hi - HL + 2048) % 2048];
      const eh = e + c.hrefl * hOut;
      this.hl[this.hi] = eh; this.hi = (this.hi + 1) % 2048;
      const back = this.dl[(this.di - L + 8192) % 8192];
      this.lpS += (back - this.lpS) * (1 - c.damp);
      const y = eh - c.refl * this.lpS;
      this.dl[this.di] = y; this.di = (this.di + 1) % 8192;
      const rad = y * (1 - c.rasp) + (y - this.prevY) * raspK * c.rasp;
      this.prevY = y;
      const nzI = this.rnd() * (0.08 + this.loadS) * (rpm / 7000);
      const yi = b0 * nzI + b2 * this.bx2 - a1 * this.by1 - a2 * this.by2;
      this.bx2 = this.bx1; this.bx1 = nzI; this.by2 = this.by1; this.by1 = yi;
      const s = rad + yi * c.intake * (0.1 + this.loadS) * 1.4 + tick * c.tick;
      const hp = s - this.hpX + 0.995 * this.hpY; this.hpX = s; this.hpY = hp;
      out[i] = Math.tanh(hp * c.gain);
    }
    return true;
  }
}
registerProcessor('engine-proc', EngineProc);`;
  // Klangcharakter je Motor
  //   pipe/header: Rohrlängen (Tonhöhe der Resonanz), damp: Dämpfung, muffle: Schalldämpfer (Hz),
  //   camp/coff: Stärke/Versatz je Zylinder, crackle: Knistern beim Gaswegnehmen,
  //   whistle: Turbopfeifen, bov: Abblasventil, vol: Gesamtlautstärke
  const ENGINE_CFG = {
    // E46 330i – M54-Sauger: seidig, viel Ansauggeräusch, metallisch oben raus, kein Turbo
    e46: { pipe: 0.0092, refl: 0.62, header: 0.0024, hrefl: 0.4, noise: 0.12, intake: 0.85, damp: 0.38, rasp: 0.42, gain: 0.24, tick: 0, muffle: 1500,
      camp: [1.0, 0.97, 1.0, 0.96, 1.02, 0.98], coff: [0, 0.002, -0.001, 0.002, -0.001, 0.001], crackle: 0.03,
      whistle: null, bov: null, vol: 1.0 },
    // M140i – B58 mit Sportauspuff: tief, laut, blubbert, knallt im Schub, kräftiger Turbo
    f21: { pipe: 0.0138, refl: 0.72, header: 0.0031, hrefl: 0.3, noise: 0.2, intake: 0.25, damp: 0.42, rasp: 0.3, gain: 0.33, tick: 0, muffle: 1250,
      camp: [1.0, 0.78, 0.97, 0.74, 1.06, 0.83], coff: [0, 0.009, -0.006, 0.011, -0.004, 0.007], crackle: 0.24,
      whistle: { base: 1700, k: 3600, vol: 0.05, type: 'sine' }, bov: { vol: 0.75, f1: 1500, f2: 3600 }, vol: 1.25 },
    // 340i Touring – B58 mit Serienauspuff: gedämpft, kultiviert, feines hohes Pfeifen
    f31: { pipe: 0.0124, refl: 0.6, header: 0.003, hrefl: 0.32, noise: 0.08, intake: 0.15, damp: 0.68, rasp: 0.14, gain: 0.22, tick: 0, muffle: 700,
      camp: [1.0, 0.95, 0.99, 0.94, 1.01, 0.96], coff: [0, 0.003, -0.002, 0.004, -0.001, 0.002], crackle: 0.012,
      whistle: { base: 2700, k: 3900, vol: 0.022, type: 'sine' }, bov: { vol: 0.3, f1: 2400, f2: 5000 }, vol: 0.85 },
    // 330d E46 – M57-Diesel: rau, kräftiges Nageln, deutliches Turbopfeifen, kein Abblasventil
    e46d: { pipe: 0.0152, refl: 0.58, header: 0.0036, hrefl: 0.3, noise: 0.34, intake: 0.12, damp: 0.6, rasp: 0.2, gain: 0.3, tick: 0.6, muffle: 620,
      camp: [1.0, 0.86, 0.96, 0.84, 1.04, 0.9], coff: [0, 0.007, -0.005, 0.009, -0.003, 0.006], crackle: 0,
      whistle: { base: 1000, k: 2600, vol: 0.055, type: 'sine' }, bov: null, vol: 1.1 },
    // 330d F31 – N57-Diesel: modern, gedämpft, leises Nageln
    f31d: { pipe: 0.0155, refl: 0.56, header: 0.0037, hrefl: 0.28, noise: 0.22, intake: 0.1, damp: 0.7, rasp: 0.1, gain: 0.26, tick: 0.3, muffle: 500,
      camp: [1.0, 0.95, 0.99, 0.94, 1.01, 0.96], coff: [0, 0.003, -0.002, 0.004, -0.001, 0.002], crackle: 0,
      whistle: { base: 1200, k: 2400, vol: 0.03, type: 'sine' }, bov: null, vol: 0.9 },
    // Traktor – Vierzylinder-Turbodiesel: tiefes Tuckern aus dem langen Schornstein, kräftiges Nageln
    tractor: { cyl: 4, pipe: 0.021, refl: 0.62, header: 0.0042, hrefl: 0.3, noise: 0.42, intake: 0.1, damp: 0.52, rasp: 0.26, gain: 0.4, tick: 0.75, muffle: 720,
      camp: [1.0, 0.86, 0.95, 0.82], coff: [0, 0.012, -0.008, 0.015], crackle: 0,
      whistle: { base: 650, k: 1500, vol: 0.045, type: 'triangle' }, bov: null, vol: 1.25 },
    // Moped 50 ccm – Einzylinder-Zweitakter mit Resonanzauspuff: hell, nasal, kreischend ("Ring-ding-ding" im Leerlauf,
    // "Neeeeeh" unter Volllast), kurze spitze Druckstöße, kleines Rohr, kaum Bass
    moped: { cyl: 1, two: true, pipe: 0.0042, refl: 0.55, header: 0.00075, hrefl: 0.55, noise: 0.3, intake: 0.35, damp: 0.28, rasp: 0.62, gain: 0.13,
      tick: 0.15, muffle: 2400, pw: 0.26, pmin: 0.0005, skip: 0.42, camp: [1.0], coff: [0], crackle: 0.12,
      whistle: null, bov: null, vol: 0.9, fMul: 1 / 3, bangMul: 0.4 },
    // Zipfer Märzen – Reihensechser mit offenem Auspuff: tiefes, gluckerndes Blubbern, knallt gern im Schub
    zipfer: { pipe: 0.0145, refl: 0.7, header: 0.0033, hrefl: 0.32, noise: 0.18, intake: 0.4, damp: 0.45, rasp: 0.28, gain: 0.32, tick: 0, muffle: 1100,
      camp: [1.0, 0.72, 0.96, 0.7, 1.08, 0.8], coff: [0, 0.012, -0.008, 0.014, -0.005, 0.009], crackle: 0.28,
      whistle: null, bov: null, vol: 1.2 },
    // Ford Fusion 1.6 Duratec – Vierzylinder mit Serienauspuff: brummig, etwas rau, ein bisschen blechern
    fusion: { cyl: 4, pipe: 0.0108, refl: 0.58, header: 0.0026, hrefl: 0.36, noise: 0.16, intake: 0.55, damp: 0.58, rasp: 0.26, gain: 0.3, tick: 0.05, muffle: 850,
      camp: [1.0, 0.9, 0.97, 0.88], coff: [0, 0.006, -0.004, 0.008], crackle: 0.02,
      whistle: null, bov: null, vol: 0.85 },
    // Ford Fusion 1.4 TDCi – kleiner Diesel: nagelt, leises Turbo-Pfeifen
    fusiond: { cyl: 4, pipe: 0.0135, refl: 0.56, header: 0.0034, hrefl: 0.3, noise: 0.36, intake: 0.1, damp: 0.6, rasp: 0.2, gain: 0.32, tick: 0.7, muffle: 600,
      camp: [1.0, 0.85, 0.95, 0.82], coff: [0, 0.01, -0.007, 0.013], crackle: 0,
      whistle: { base: 1100, k: 2300, vol: 0.04, type: 'sine' }, bov: null, vol: 0.95 },
    // Ford Focus 1.0 EcoBoost – Dreizylinder-Turbo: unrund-knurrig (ungerade Zündfolge), leichtes Turbo-Pfeifen, leises Abblasen
    focus: { cyl: 3, pipe: 0.0112, refl: 0.6, header: 0.0028, hrefl: 0.34, noise: 0.15, intake: 0.3, damp: 0.6, rasp: 0.3, gain: 0.3, tick: 0.08, muffle: 800,
      camp: [1.0, 0.84, 0.93], coff: [0, 0.014, -0.01], crackle: 0.03,
      whistle: { base: 1500, k: 3200, vol: 0.035, type: 'sine' }, bov: { vol: 0.3, f1: 2000, f2: 4200 }, vol: 0.9 },
    // Focus ST 2.3 EcoBoost – Vierzylinder-Turbo mit Klappenauspuff: kernig, knallt im Schub, Turbo deutlich hörbar
    focusst: { cyl: 4, pipe: 0.0128, refl: 0.66, header: 0.003, hrefl: 0.32, noise: 0.2, intake: 0.35, damp: 0.46, rasp: 0.32, gain: 0.33, tick: 0, muffle: 1150,
      camp: [1.0, 0.82, 0.96, 0.8], coff: [0, 0.008, -0.005, 0.01], crackle: 0.22,
      whistle: { base: 1600, k: 3500, vol: 0.05, type: 'sine' }, bov: { vol: 0.6, f1: 1600, f2: 3800 }, vol: 1.15 },
    // VW Polo 1.2 TSI – kleiner Turbo-Vierzylinder, Serienauspuff: sauber, etwas surrend, kaum Pfeifen
    polo: { cyl: 4, pipe: 0.0105, refl: 0.58, header: 0.0025, hrefl: 0.36, noise: 0.12, intake: 0.35, damp: 0.64, rasp: 0.2, gain: 0.28, tick: 0.04, muffle: 780,
      camp: [1.0, 0.93, 0.98, 0.91], coff: [0, 0.004, -0.003, 0.005], crackle: 0.01,
      whistle: { base: 1900, k: 3600, vol: 0.022, type: 'sine' }, bov: null, vol: 0.8 },
    // Polo GTI 1.4 TSI – Kompressor + Turbo: heller, giftiger Vierzylinder, Kompressor-Surren, Abblasventil
    pologti: { cyl: 4, pipe: 0.0112, refl: 0.66, header: 0.0027, hrefl: 0.33, noise: 0.18, intake: 0.5, damp: 0.5, rasp: 0.3, gain: 0.32, tick: 0, muffle: 1100,
      camp: [1.0, 0.84, 0.97, 0.82], coff: [0, 0.007, -0.005, 0.009], crackle: 0.14,
      whistle: { base: 2200, k: 4200, vol: 0.05, type: 'sine' }, bov: { vol: 0.55, f1: 1800, f2: 4200 }, vol: 1.05 },
    // Polo 1.6 TDI – Common-Rail-Diesel: nagelt, brummig, leises Turbo-Pfeifen
    polod: { cyl: 4, pipe: 0.0138, refl: 0.56, header: 0.0034, hrefl: 0.3, noise: 0.34, intake: 0.1, damp: 0.62, rasp: 0.18, gain: 0.31, tick: 0.62, muffle: 590,
      camp: [1.0, 0.86, 0.95, 0.83], coff: [0, 0.009, -0.006, 0.012], crackle: 0,
      whistle: { base: 1100, k: 2400, vol: 0.045, type: 'sine' }, bov: null, vol: 0.95 },
    // Moped 50 ccm – Einzylinder-Viertakter: zündet nur jede zweite Umdrehung -> tiefes „Pöp-pöp“ im Leerlauf,
    // gleichmäßig (keine Aussetzer), gedämpfter Serienauspuff, etwas Ventiltickern
    moped4: { cyl: 1, two: false, pipe: 0.0065, refl: 0.6, header: 0.0012, hrefl: 0.45, noise: 0.22, intake: 0.4, damp: 0.5, rasp: 0.35, gain: 0.2,
      tick: 0.25, muffle: 1300, pw: 0.22, pmin: 0.0008, skip: 0, camp: [1.0], coff: [0], crackle: 0.05,
      whistle: null, bov: null, vol: 0.85, fMul: 1 / 6, bangMul: 0.35 },
    // Elektro-Rollstuhl / -Rollator: kein Verbrenner, nur hohes E-Motor-Surren
    wheelchair: { electric: true, whine: { base: 90, k: 0.08, vol: 0.012 }, whistle: null, bov: null, vol: 0 },
    rollator: { electric: true, whine: { base: 180, k: 0.19, vol: 0.05 }, whistle: null, bov: null, vol: 0 },
    // 530d – B57-Diesel: tiefes Grollen, Nageln, dumpfes Turbo-Rauschen, kein Abblasventil
    g31: { pipe: 0.0162, refl: 0.55, header: 0.0038, hrefl: 0.28, noise: 0.32, intake: 0.1, damp: 0.66, rasp: 0.14, gain: 0.3, tick: 0.45, muffle: 560,
      camp: [1.0, 0.88, 0.97, 0.86, 1.03, 0.9], coff: [0, 0.006, -0.004, 0.007, -0.003, 0.005], crackle: 0,
      whistle: { base: 850, k: 2100, vol: 0.06, type: 'triangle' }, bov: null, vol: 1.05 },
    // 520d – B47-Vierzylinder-Diesel: brummiger, mehr Nageln, hellerer Turbo, weniger Bass als der Sechser
    g31d4: { cyl: 4, pipe: 0.0142, refl: 0.56, header: 0.0035, hrefl: 0.3, noise: 0.34, intake: 0.1, damp: 0.64, rasp: 0.18, gain: 0.31, tick: 0.62, muffle: 580,
      camp: [1.0, 0.86, 0.96, 0.84], coff: [0, 0.009, -0.006, 0.011], crackle: 0,
      whistle: { base: 1050, k: 2400, vol: 0.05, type: 'triangle' }, bov: null, vol: 1.0 },
    // Koenigsegg Jesko – V8-Biturbo mit flacher Kurbelwelle: hell, kreischend, rau, Turbo-Zischen, Abblasventil
    jesko: { cyl: 8, pipe: 0.0082, refl: 0.66, header: 0.0019, hrefl: 0.42, noise: 0.17, intake: 0.55, damp: 0.34, rasp: 0.52, gain: 0.3, tick: 0, muffle: 2000,
      camp: [1.0, 0.82, 0.97, 0.8, 1.04, 0.86, 0.95, 0.84], coff: [0, 0.006, -0.004, 0.008, -0.003, 0.005, -0.002, 0.007], crackle: 0.22,
      whistle: { base: 1500, k: 3900, vol: 0.055, type: 'sine' }, bov: { vol: 0.65, f1: 1700, f2: 4200 }, vol: 1.25 }
  };
  ENGINE_CFG.jeskop = ENGINE_CFG.jesko;   // Super-98-Variante klingt gleich

  // Hupen je Fahrzeug: Grundtöne (Hz), Formant-Filter, Lautstärke
  const HORNS = {
    car: { f: [415, 500], bp: 1150, q: 1.3, vol: 0.2 },      // Zweiklang-Fanfare
    moped: { f: [735], bp: 1700, q: 2.2, vol: 0.12 },        // dünnes „Mööp“
    tractor: { f: [262, 330], bp: 700, q: 1.0, vol: 0.26 },  // tief und brummig
    small: { f: [1050], bp: 2100, q: 3.2, vol: 0.08 },       // piepsige Fahrradhupe
    bottle: { f: [349, 440], bp: 950, q: 1.3, vol: 0.2 },    // Zipfer: etwas tiefer, fröhlich
    jonny: { bell: true, f: [2350, 2510, 5120, 7480, 10300], amp: [1, 0.85, 0.45, 0.22, 0.1], vol: 0.9, direct: true }   // Jonny: laute Fahrradklingel (Dring-dring), lauteste Hupe
  };
  const hornType = (k) => { k = String(k || ''); return k.startsWith('moped') ? 'moped' : k === 'tractor' ? 'tractor' : k === 'wheelchair' ? 'jonny' : k === 'rollator' ? 'small' : k === 'zipfer' ? 'bottle' : 'car'; };

  class Sound {
    constructor() { this.ready = false; this.muted = false; }
    init() {
      if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      comp.connect(this.master);

      // ---- Motor: S54-Reihensechser ----
      // Eine Wellenform = ein kompletter Arbeitszyklus (2 Kurbelumdrehungen) mit 6 Abgaspulsen.
      // Leicht unterschiedliche Pulse je Zylinder erzeugen die halben Ordnungen -> tiefes Brummen.
      const NH = 72, re = new Float32Array(NH + 1), im = new Float32Array(NH + 1);
      const amps = [1.0, 0.82, 0.94, 0.78, 0.97, 0.86], SM = 2048, wave = new Float32Array(SM);
      for (let i = 0; i < SM; i++) {
        const t = i / SM; let v = 0;
        for (let k = 0; k < 6; k++) {
          let tl = t - k / 6 - (k % 2 ? 0.006 : 0); if (tl < 0) tl += 1;
          v += amps[k] * Math.exp(-tl * 34) * Math.sin(Math.min(1, tl * 9) * Math.PI) - amps[k] * 0.18 * Math.exp(-tl * 9);
        }
        wave[i] = v;
      }
      for (let n = 1; n <= NH; n++) {
        let a = 0, b2 = 0;
        for (let i = 0; i < SM; i++) { const ph = 2 * Math.PI * n * i / SM; a += wave[i] * Math.cos(ph); b2 += wave[i] * Math.sin(ph); }
        const roll = 1 / (1 + Math.pow(n / 30, 2));
        re[n] = a / SM * roll; im[n] = b2 / SM * roll;
      }
      const pw = ctx.createPeriodicWave(re, im);
      this.eng = ctx.createGain(); this.eng.gain.value = 0;
      const pre = ctx.createGain(); pre.gain.value = 1.6;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.6); }
      shaper.curve = curve;
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 400; this.lp.Q.value = 0.8;
      const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 160; shelf.gain.value = 9;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 95; mid.gain.value = 5; mid.Q.value = 0.8;
      this.oscs = [];
      for (const det of [0, 9, -6]) {
        const o = ctx.createOscillator(); o.setPeriodicWave(pw); o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = det ? 0.35 : 0.7; o.connect(g); g.connect(pre); o.start();
        this.oscs.push({ o, mult: 1 });
      }
      // Ansaug-Röhren bei hoher Drehzahl (S54 Einzeldrosselklappen)
      this.intake = ctx.createGain(); this.intake.gain.value = 0;
      const ib = ctx.createBiquadFilter(); ib.type = 'bandpass'; ib.frequency.value = 700; ib.Q.value = 1.4; this.intakeF = ib;
      pre.connect(ib); ib.connect(this.intake);
      pre.connect(shaper); shaper.connect(this.lp); this.lp.connect(shelf); shelf.connect(mid); mid.connect(this.eng);
      this.intake.connect(this.eng);
      this.eng.connect(comp);

      // ---- Rauschen ----
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;
      const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.start();
      this.sq1 = ctx.createBiquadFilter(); this.sq1.type = 'bandpass'; this.sq1.frequency.value = 1150; this.sq1.Q.value = 9;
      this.sq2 = ctx.createBiquadFilter(); this.sq2.type = 'bandpass'; this.sq2.frequency.value = 1750; this.sq2.Q.value = 12;
      this.squeal = ctx.createGain(); this.squeal.gain.value = 0;
      ns.connect(this.sq1); ns.connect(this.sq2); this.sq1.connect(this.squeal); this.sq2.connect(this.squeal); this.squeal.connect(comp);
      // Wind / Abrollen
      const ns2 = ctx.createBufferSource(); ns2.buffer = nb; ns2.loop = true; ns2.start(0, 0.7);
      this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
      this.wind = ctx.createGain(); this.wind.gain.value = 0;
      ns2.connect(this.windF); this.windF.connect(this.wind); this.wind.connect(comp);
      this.comp = comp;
      // neuer Motor per AudioWorklet (Fallback: alter Synth)
      this.wLp = ctx.createBiquadFilter(); this.wLp.type = 'lowpass'; this.wLp.frequency.value = 1500; this.wLp.Q.value = 0.6;
      this.wShelf = ctx.createBiquadFilter(); this.wShelf.type = 'lowshelf'; this.wShelf.frequency.value = 140; this.wShelf.gain.value = 6;
      this.wGain = ctx.createGain(); this.wGain.gain.value = 0;
      this.wLp.connect(this.wShelf); this.wShelf.connect(this.wGain); this.wGain.connect(comp);
      if (ctx.audioWorklet && window.Blob) {
        try {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
          ctx.audioWorklet.addModule(url).then(() => {
            this.workletOk = true;
            this.engNode = new AudioWorkletNode(ctx, 'engine-proc', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
            this.engNode.connect(this.wLp);
            this.engNode.port.postMessage(ENGINE_CFG[this.model] || ENGINE_CFG.e46);
            if (this.als) this.setAls(true);
          }).catch(() => { this.engNode = null; });
        } catch (e) { this.engNode = null; }
      }
      // eigener Kanal für Fehlzündungen: am Kompressor vorbei, nur weich begrenzt -> richtig laut
      this.bangBus = ctx.createGain(); this.bangBus.gain.value = 1.0;
      const bs = ctx.createWaveShaper(), bc = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; bc[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
      bs.curve = bc; this.bangBus.connect(bs); bs.connect(this.master);
      // Diesel-Nageln: hochpassgefiltertes Rauschen, im Zündtakt moduliert
      const ns3 = ctx.createBufferSource(); ns3.buffer = nb; ns3.loop = true; ns3.start(0, 1.3);
      const kf = ctx.createBiquadFilter(); kf.type = 'bandpass'; kf.frequency.value = 2600; kf.Q.value = 1.2;
      this.knockAM = ctx.createGain(); this.knockAM.gain.value = 0;
      this.knockOsc = ctx.createOscillator(); this.knockOsc.type = 'square'; this.knockOsc.frequency.value = 40;
      this.knockDepth = ctx.createGain(); this.knockDepth.gain.value = 0;
      this.knockOsc.connect(this.knockDepth); this.knockDepth.connect(this.knockAM.gain); this.knockOsc.start();
      this.knock = ctx.createGain(); this.knock.gain.value = 0;
      ns3.connect(kf); kf.connect(this.knockAM); this.knockAM.connect(this.knock); this.knock.connect(comp);
      // Turbolader-Pfeifen
      this.whistle = ctx.createOscillator(); this.whistle.type = 'sine'; this.whistle.frequency.value = 2000;
      this.whistleG = ctx.createGain(); this.whistleG.gain.value = 0;
      this.whistle.connect(this.whistleG); this.whistleG.connect(comp); this.whistle.start();
      if (this.model) { const ec0 = ENGINE_CFG[this.model]; if (ec0 && (ec0.whistle || ec0.electric)) this.whistle.type = ec0.electric ? 'sawtooth' : ec0.whistle.type; }
      this.ready = true;
      this.setMuted(this.muted);
    }
    // Gesamtlautstärke: v = 0..1.5 (1 = Standard)
    setMuted(m) { this.muted = m; this._applyMaster(); }
    setVolume(v) { this.volume = Math.max(0, Math.min(1.5, +v || 0)); this._applyMaster(); }
    // Spielgeräusche kurz leiser machen (z. B. während Jonny „Digi digi“ schreit), 1 = normal
    setDuck(k) { this.duck = Math.max(0, Math.min(1, k)); this._applyMaster(); }
    _applyMaster() {
      if (!this.ready) return;
      const vol = this.volume == null ? 1 : this.volume, duck = this.duck == null ? 1 : this.duck;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55 * vol * duck, this.ctx.currentTime, duck < 1 ? 0.03 : 0.25);
    }
    // Anti-Lag: mehr Knistern im Schub
    setAls(on) {
      this.als = !!on;
      const ec = ENGINE_CFG[this.model] || ENGINE_CFG.e46;
      if (this.engNode) this.engNode.port.postMessage({ crackle: on ? Math.max(0.3, ec.crackle || 0) : (ec.crackle != null ? ec.crackle : 0.07) });
    }
    setEngine(model, diesel) {
      this.model = model; this.diesel = !!diesel;
      const ec = ENGINE_CFG[model] || ENGINE_CFG.e46;
      this.turbo = !!ec.whistle;
      if (this.ready) this.whistle.type = ec.electric ? 'sawtooth' : (ec.whistle ? ec.whistle.type : 'sine');
      if (this.engNode) this.engNode.port.postMessage(ec);
    }
    update(rpm, throttle, slip, speed, active, cut, boost) {
      boost = boost || 0;
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const f = rpm / 120;                  // Arbeitszyklus (Zündfrequenz = 6 * f)
      const fMul = (ENGINE_CFG[this.model] || {}).fMul || 1;
      for (const o of this.oscs) o.o.frequency.setTargetAtTime(f * fMul, t, 0.025);
      const on = active ? 1 : 0;
      const thr = cut ? 0.05 : throttle;
      const r = rpm / 8000;
      const dz = this.diesel ? 0.55 : 1;
      this.lp.frequency.setTargetAtTime((160 + rpm * 0.09 + thr * 650 + r * r * 900) * dz, t, 0.05);
      // Diesel: Nageln im Zündtakt
      this.knockOsc.frequency.setTargetAtTime(Math.max(20, rpm / 120 * ((ENGINE_CFG[this.model] || {}).cyl || 6)), t, 0.03);
      this.knockDepth.gain.setTargetAtTime(this.diesel ? 0.5 : 0, t, 0.05);
      this.knockAM.gain.setTargetAtTime(this.diesel ? 0.5 : 0, t, 0.05);
      this.knock.gain.setTargetAtTime(on * (this.diesel ? (this.engNode ? 0.04 + thr * 0.05 : 0.10 + thr * 0.12) : 0), t, 0.05);
      // Turbo pfeift mit Ladedruck
      const ecAll = ENGINE_CFG[this.model] || ENGINE_CFG.e46;
      if (ecAll.electric) {
        // E-Motor: Surren steigt mit der Drehzahl, lauter unter Last
        const wh = ecAll.whine;
        this.whistle.frequency.setTargetAtTime(wh.base + rpm * wh.k, t, 0.04);
        this.whistleG.gain.setTargetAtTime(on * wh.vol * (0.35 + throttle * 0.9) * Math.min(1, 0.3 + rpm / 4000), t, 0.05);
      } else {
        const ecw = ecAll.whistle || { base: 1600, k: 3200, vol: 0.035 };
        const tb = (this.turbo ? 0.6 : 0) + (boost > 0 ? 0.4 : 0);
        this.whistle.frequency.setTargetAtTime(ecw.base + boost * ecw.k + rpm * 0.15, t, 0.08);
        this.whistleG.gain.setTargetAtTime(on * tb * boost * ecw.vol, t, 0.08);
      }
      this.intake.gain.setTargetAtTime(ecAll.electric ? 0 : on * thr * Math.max(0, r - 0.45) * 0.55, t, 0.06);
      this.intakeF.frequency.setTargetAtTime(400 + rpm * 0.12, t, 0.05);
      if (this.engNode) {
        // neuer Motor aktiv: alten Synth stumm schalten
        this.eng.gain.setTargetAtTime(0, t, 0.05);
        const P = this.engNode.parameters, ec = ENGINE_CFG[this.model] || ENGINE_CFG.e46;
        P.get('rpm').setValueAtTime(Math.max(400, rpm), t);
        P.get('load').setValueAtTime(Math.max(0, Math.min(1, throttle)), t);
        P.get('cut').setValueAtTime(cut ? 1 : 0, t);
        this.wLp.frequency.setTargetAtTime((ec.muffle || 1200) + rpm * 0.32 + throttle * 1400, t, 0.05);
        this.wGain.gain.setTargetAtTime(on * (1.1 + throttle * 0.5) * (ec.vol != null ? ec.vol : 1), t, 0.04);
      } else {
        this.eng.gain.setTargetAtTime(ecAll.electric ? 0 : on * (0.32 + thr * 0.4 + r * 0.15), t, cut ? 0.01 : 0.05);
      }
      const sq = Math.max(0, Math.min(1, (slip - 3) / 10));
      this.squeal.gain.setTargetAtTime(on * sq * 0.5, t, 0.06);
      this.sq1.frequency.setTargetAtTime(1050 + Math.sin(t * 13) * 60 + sq * 120, t, 0.05);
      this.wind.gain.setTargetAtTime(on * Math.min(0.25, speed / 160), t, 0.2);
      this.windF.frequency.setTargetAtTime(300 + speed * 12, t, 0.2);
    }
    burst(dur, freq, gain, type) {
      if (!this.ready || this.muted) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.comp); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    blowoff() {
      if (!this.ready || this.muted) return;
      const n = this.ctx.currentTime;
      if (this._lastBlow && n - this._lastBlow < 0.6) return;
      this._lastBlow = n;
      // Abblasventil je Motor (Diesel hat keins; Turbo-Tuning ohne eigenes Profil: Standard)
      const bv = (ENGINE_CFG[this.model] || {}).bov;
      if (bv === null && this.diesel) return;
      const b = bv || { vol: 0.55, f1: 1800, f2: 4200 };
      this.burst(0.45, b.f1, b.vol, 'highpass'); this.burst(0.25, b.f2, b.vol * 0.45, 'bandpass');
    }
    // Fehlzündung: scharfer Knall + tiefer Wumms + Knistern
    // at = { gain, pan } für Knalle anderer Spieler (leiser je nach Entfernung, links/rechts); ohne at = eigenes Auto
    bang(strength, at) {
      if (!at) this.ownBangs = (this.ownBangs || 0) + 1;     // wird an die anderen Spieler übertragen
      if (!this.ready || this.muted) return;
      const s = Math.max(0.3, Math.min(1.3, strength == null ? 1 : strength)) * (!at && (ENGINE_CFG[this.model] || {}).bangMul || 1);
      const ctx = this.ctx, t = ctx.currentTime;
      let out = this.bangBus;
      if (at) {
        if (at.gain < 0.02) return;
        const g = ctx.createGain(); g.gain.value = at.gain; const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, at.pan || 0));
        g.connect(p); p.connect(this.bangBus); out = g;
        setTimeout(() => { try { g.disconnect(); p.disconnect(); } catch (e) { /* */ } }, 900);
      }
      const noise = (start, dur, type, freq, q, gain) => {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + start); g.gain.linearRampToValueAtTime(gain, t + start + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0005, t + start + dur);
        src.connect(f); f.connect(g); g.connect(out); src.start(t + start, Math.random() * 1.5); src.stop(t + start + dur + 0.05);
      };
      noise(0, 0.045, 'highpass', 700, 0.5, 2.2 * s);          // Peitschenknall
      noise(0, 0.16, 'lowpass', 1100, 0.9, 1.6 * s);           // Körper
      const o = ctx.createOscillator(); o.type = 'sine';        // Wumms im Auspuff
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(1.8 * s, t + 0.004); og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.32);
      const n = 2 + (Math.random() * 4 | 0);                    // Nachknistern
      for (let i = 0; i < n; i++) noise(0.05 + Math.random() * 0.3, 0.025, 'bandpass', 1800 + Math.random() * 2500, 1.5, (0.35 + Math.random() * 0.45) * s);
    }
    // ---------- Motoren der anderen Spieler ----------
    // je Spieler eine eigene Motor-Simulation + Reifenquietschen, mit Entfernung und Links/Rechts
    voice(id, key) {
      if (!this.ready || !this.workletOk) return null;
      this.voices = this.voices || new Map();
      let v = this.voices.get(id);
      if (v && v.key !== key) { this.dropVoice(id); v = null; }
      if (v) return v;
      const ctx = this.ctx, ec = ENGINE_CFG[key] || ENGINE_CFG.e46;
      v = { key, ec };
      v.pan = ctx.createStereoPanner(); v.out = ctx.createGain(); v.out.gain.value = 0;
      v.out.connect(v.pan); v.pan.connect(this.comp);
      if (!ec.electric) {
        v.node = new AudioWorkletNode(ctx, 'engine-proc', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        v.node.port.postMessage(ec);
        v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.Q.value = 0.6;
        v.sh = ctx.createBiquadFilter(); v.sh.type = 'lowshelf'; v.sh.frequency.value = 140; v.sh.gain.value = 6;
        v.node.connect(v.lp); v.lp.connect(v.sh); v.sh.connect(v.out);
      } else {
        v.osc = ctx.createOscillator(); v.osc.type = 'sawtooth'; v.og = ctx.createGain(); v.og.gain.value = 0;
        v.osc.connect(v.og); v.og.connect(v.out); v.osc.start();
      }
      v.ns = ctx.createBufferSource(); v.ns.buffer = this.noiseBuf; v.ns.loop = true; v.ns.start(0, Math.random() * 1.5);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 9;
      v.sq = ctx.createGain(); v.sq.gain.value = 0; v.ns.connect(bp); bp.connect(v.sq); v.sq.connect(v.pan);
      this.voices.set(id, v);
      return v;
    }
    // o: rpm, load (0..1), cut, slip, gain (Entfernung 0..1), pan (-1..1)
    updateVoice(id, key, o) {
      const v = this.voice(id, key); if (!v) return;
      const t = this.ctx.currentTime, ec = v.ec, ld = Math.max(0, Math.min(1, o.load || 0)), rpm = Math.max(400, o.rpm || 0);
      if (v.node) {
        const P = v.node.parameters;
        P.get('rpm').setValueAtTime(rpm, t); P.get('load').setValueAtTime(ld, t); P.get('cut').setValueAtTime(o.cut ? 1 : 0, t);
        v.lp.frequency.setTargetAtTime((ec.muffle || 1200) + rpm * 0.32 + ld * 1400, t, 0.05);
        v.out.gain.setTargetAtTime(o.gain * (1.1 + ld * 0.5) * (ec.vol != null ? ec.vol : 1) * 0.9, t, 0.06);
      } else {
        const wh = ec.whine;
        v.osc.frequency.setTargetAtTime(wh.base + rpm * wh.k, t, 0.04);
        v.og.gain.setTargetAtTime(wh.vol * (0.35 + ld * 0.9) * Math.min(1, 0.3 + rpm / 4000), t, 0.05);
        v.out.gain.setTargetAtTime(o.gain, t, 0.06);
      }
      const sq = Math.max(0, Math.min(1, ((o.slip || 0) - 3) / 10));
      v.sq.gain.setTargetAtTime(o.gain * sq * 0.5, t, 0.06);
      if (o.horn || v.hn) {
        if (!v.hn) v.hn = this._hornMake(hornType(key), v.pan);
        if (v.hn.bell) this._bellTick(v.hn, !!o.horn, v.hn.vol * Math.min(1, o.gain * 1.6));
        else v.hn.g.gain.setTargetAtTime(o.horn ? v.hn.vol * Math.min(1, o.gain * 1.6) : 0, t, o.horn ? 0.006 : 0.025);
      }
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, o.pan || 0)), t, 0.05);
    }
    dropVoice(id) {
      const v = this.voices && this.voices.get(id); if (!v) return;
      this._hornKill(v.hn);
      try { v.out.gain.value = 0; v.sq.gain.value = 0; v.ns.stop(); if (v.osc) v.osc.stop(); if (v.node) { v.node.port.close && v.node.port.close(); v.node.disconnect(); } v.pan.disconnect(); } catch (e) { /* */ }
      this.voices.delete(id);
    }
    voiceIds() { return this.voices ? [...this.voices.keys()] : []; }
    // Martinshorn (Polizei): Zweiklang ~466/622 Hz, je 0,65 s; on = Lautstärke 0..1 nach Entfernung, pan = links/rechts
    siren(on, pan) {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      if (!this.sir) {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 466;
        const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 466 * 2.01;
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7;
        const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900; bp.gain.value = 6;
        const g = ctx.createGain(); g.gain.value = 0;
        const p = ctx.createStereoPanner();
        o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(bp); bp.connect(g); g.connect(p); p.connect(this.comp);
        o.start(); o2.start();
        this.sir = { o, o2, g, p, t0: t };
      }
      const S = this.sir, hi = Math.floor((t - S.t0) / 0.65) % 2 === 1, f = hi ? 622 : 466;
      S.o.frequency.setTargetAtTime(f, t, 0.012); S.o2.frequency.setTargetAtTime(f * 2.01, t, 0.012);
      S.g.gain.setTargetAtTime(Math.max(0, Math.min(1, on || 0)) * 0.16, t, 0.08);
      S.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan || 0)), t, 0.05);
    }
    // Hupe: Sägezähne -> leichte Sättigung -> Formant -> Hüllkurve; dest = Ausgang (eigenes Auto oder Stimme eines Mitspielers)
    _hornMake(type, dest) {
      const ctx = this.ctx, H = HORNS[type] || HORNS.car;
      if (H.bell) {   // Klingel: unharmonische Teiltöne (Schlagglocke), jeder Schlag mit eigenem Abklingen
        const env = ctx.createGain(); env.gain.value = 0;
        const sh = ctx.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 511.5 - 1) * 1.6); sh.curve = cv;
        const g = ctx.createGain(); g.gain.value = 0;
        const os = H.f.map((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const a = ctx.createGain(); a.gain.value = H.amp[i] * 0.45; o.connect(a); a.connect(env); o.start(); return o; });
        env.connect(sh); sh.connect(g); g.connect(dest);
        return { os, g, env, type, vol: H.vol, bell: true, next: 0, n: 0 };
      }
      const mix = ctx.createGain(); mix.gain.value = 0.5;
      const ws = ctx.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(x * (H.drive || 2.2)); } ws.curve = cv;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = H.bp; bp.Q.value = H.q;
      const lo = ctx.createBiquadFilter(); lo.type = 'peaking'; lo.frequency.value = H.f[0] * 1.5; lo.gain.value = 5;
      const g = ctx.createGain(); g.gain.value = 0;
      const os = H.f.map((f, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = i ? 6 : -4; o.connect(mix); o.start(); return o; });
      mix.connect(ws); ws.connect(bp); bp.connect(lo); lo.connect(g); g.connect(dest);
      return { os, g, type, vol: H.vol };
    }
    // Klingel: solange gedrückt im Digi-digi-Rhythmus (hoch-tief, Pause), losgelassen klingt sie aus
    _bellTick(h, on, level) {
      const t = this.ctx.currentTime;
      h.g.gain.setTargetAtTime(level, t, 0.01);
      if (!on) { h.n = 0; h.next = 0; return; }
      if (t < h.next) return;
      const e = h.env.gain; e.cancelScheduledValues(t); e.setValueAtTime(Math.max(0.0001, e.value), t);
      e.linearRampToValueAtTime(1, t + 0.003); e.exponentialRampToValueAtTime(0.18, t + 0.07); e.exponentialRampToValueAtTime(0.0005, t + 1.1);
      for (const o of h.os) o.detune.setValueAtTime(h.n % 2 ? -320 : 0, t);   // „DI“ hoch, „gi“ tiefer
      h.n++; h.next = t + (h.n % 2 ? 0.1 : 0.17);                                  // di-gi · di-gi · di-gi …
    }
    _hornKill(h) { if (!h) return; try { h.g.gain.value = 0; for (const o of h.os) o.stop(); h.g.disconnect(); } catch (e) { /* */ } }
    // eigene Hupe (gedrückt halten); key = Motor-/Fahrzeug-Schlüssel
    horn(on, key) {
      if (!this.ready) return;
      const type = hornType(key);
      if (!this.hn || this.hn.type !== type) { if (!on && !this.hn) return; this._hornKill(this.hn); this.hn = this._hornMake(type, HORNS[type] && HORNS[type].direct ? this.master : this.comp); }
      if (this.hn.bell) this._bellTick(this.hn, on, this.hn.vol);
      else this.hn.g.gain.setTargetAtTime(on ? this.hn.vol : 0, this.ctx.currentTime, on ? 0.006 : 0.025);
    }
    pop() { this.burst(0.09 + Math.random() * 0.06, 700 + Math.random() * 500, 0.9); }
    crash(strength) { this.burst(0.35, 260, Math.min(1.2, 0.3 + strength * 0.08)); this.burst(0.15, 2200, Math.min(0.5, strength * 0.04), 'bandpass'); }
    click() { this.burst(0.03, 3000, 0.25, 'bandpass'); }
  }
  window.Sound = new Sound();
  window.__ENGINE_WORKLET = WORKLET_SRC; window.__ENGINE_CFG = ENGINE_CFG;
})();
