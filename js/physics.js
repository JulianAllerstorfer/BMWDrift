/* =====================================================================
   Driftphysik v2
   - Einspurmodell mit echter Raddrehzahl an der Hinterachse (halb-implizit)
   - kombinierter Schlupf (Längs + Quer) mit eigener Reifenkennlinie
   - Lastabhängiger Grip, Querlastverlagerung, Sperrdifferenzial
   - Reifentemperatur, Reifendruck, Einlaufverzögerung (Relaxation)
   - Motor mit Drehmomentkurve (Sauger / Turbo / Diesel), Turbolader-Mod
   Weltkoordinaten: x/z-Ebene, Fahrtrichtung f = (cos h, -sin h)
   Gierwinkel h steigt = Linkskurve. rechts = (sin h, cos h)
   ===================================================================== */
(function () {
  'use strict';

  const G = 9.81;
  const CURVES = {
    na6: [[600, 0.5], [1000, 0.5], [3000, 0.86], [4600, 1], [6200, 0.904], [7300, 0.72], [8200, 0.55]],
    turbo: [[600, 0.42], [1300, 0.85], [1600, 1], [4500, 1], [5500, 0.92], [6500, 0.78], [7300, 0.62]],
    diesel: [[500, 0.38], [1200, 0.75], [1750, 1], [2600, 1], [3500, 0.85], [4400, 0.62], [5300, 0.42]],
    electric: [[500, 1], [4000, 1], [5000, 0.97], [6500, 0.8], [8000, 0.64], [9000, 0.55], [9600, 0.3]],
    tractor: [[500, 0.62], [900, 0.9], [1300, 1], [1700, 0.98], [2100, 0.88], [2400, 0.72], [2700, 0.5]],
    // 50-ccm-Zweitakter: unten kaum Kraft, dann scharf ins Resonanzband ("kommt ins Rohr")
    // Ford 1,6-l-Duratec (Sigma): kein Turbo, max. Drehmoment ~4000/min, Leistung bei 6000/min
    duratec: [[700, 0.5], [1500, 0.68], [2500, 0.82], [3500, 0.95], [4000, 1], [4800, 0.97], [5500, 0.9], [6000, 0.81], [6500, 0.68], [7000, 0.45]],
    // 50-ccm-Viertakter (getunt): gleichmäßiger, breiteres Band, dreht niedriger
    fourstroke: [[1200, 0.55], [3000, 0.75], [5000, 0.92], [6500, 1], [7800, 0.95], [8800, 0.8], [9500, 0.6], [10000, 0.35]],
    // Ford 1,0-l-EcoBoost (Dreizylinder-Turbo, Mildhybrid): früh volles Drehmoment, flaches Plateau, oben raus etwas zäh
    ecoboost3: [[700, 0.45], [1400, 0.8], [1900, 1], [4000, 1], [5000, 0.94], [6000, 0.86], [6500, 0.74], [7000, 0.5]],
    // VW 1,2-l-TSI (Vierzylinder-Turbo): Plateau 1550–4100/min, fällt danach recht schnell ab
    tsi: [[700, 0.5], [1300, 0.8], [1550, 1], [4100, 1], [5000, 0.84], [5500, 0.76], [6000, 0.64], [6500, 0.45]],
    twostroke: [[1500, 0.28], [3000, 0.4], [5000, 0.58], [6500, 0.78], [7800, 0.95], [8600, 1], [9600, 0.94], [10400, 0.74], [11000, 0.45]]
  };
  // Grunddaten je Fahrzeug
  const MODELS = {
    e46: { mass: 1420, a: 1.33, b: 1.395, wheelR: 0.316, trackW: 1.48, curve: 'na6', maxTorque: 420, idle: 900, redline: 7300, gears: [0, 3.15, 2.28, 1.72, 1.34, 1.10, 0.92], final: 3.91, drag: 0.42 },
    f21: { mass: 1475, a: 1.30, b: 1.39, wheelR: 0.318, trackW: 1.53, curve: 'turbo', maxTorque: 500, idle: 750, redline: 7000, gears: [0, 3.6, 2.25, 1.62, 1.25, 1.03, 0.86], final: 3.46, drag: 0.40 },
    f31: { mass: 1650, a: 1.40, b: 1.41, wheelR: 0.322, trackW: 1.54, curve: 'turbo', maxTorque: 470, idle: 750, redline: 7000, gears: [0, 3.6, 2.25, 1.62, 1.25, 1.03, 0.86], final: 3.38, drag: 0.40 },
    // Traktor: schwer, hoher Schwerpunkt, riesige Hinterräder, kurze Übersetzung, ~60 km/h Spitze
    tractor: { mass: 3300, a: 1.45, b: 1.15, wheelR: 0.82, trackW: 1.72, curve: 'tractor', maxTorque: 1450, idle: 750, redline: 2500,
      gears: [0, 3.2, 2.4, 1.85, 1.45, 1.15, 0.95], final: 6.2, drag: 0.95, diesel: true, cgH: 0.85, iWheel: 9 },
    // Elektro-Rollstuhl (~180 km/h) und -Rollator (~300 km/h): leicht, kurzer Radstand, E-Motor
    wheelchair: { mass: 240, a: 0.40, b: 0.34, wheelR: 0.30, trackW: 0.66, curve: 'electric', maxTorque: 270, idle: 600, redline: 9000,
      gears: [0, 2.6, 1.9, 1.45, 1.18, 1.0, 0.86], final: 6.3, drag: 0.16, rollRes: 5, electric: true, flames: true, izMul: 4, cgH: 0.45, iWheel: 0.35, iEngine: 0.03,
      muRMul: 0.88, slideMin: 0.93 },   // Jonny: hinten etwas weniger Grip, gutmütiger Abriss, ruhigeres Eindrehen -> mehr Winkel, leichter zu halten
    rollator: { mass: 230, a: 0.30, b: 0.25, wheelR: 0.11, trackW: 0.54, curve: 'electric', maxTorque: 450, idle: 600, redline: 9000,
      gears: [0, 2.6, 1.9, 1.45, 1.18, 1.0, 0.86], final: 1.38, drag: 0.3, rollRes: 5, electric: true, izMul: 3.6, cgH: 0.5, iWheel: 0.08, iEngine: 0.03 },
    // Moped 50 ccm (stark getunt): leicht, Einspur, Fliehkraftkupplung, ~130 km/h
    moped: { mass: 165, a: 0.62, b: 0.58, wheelR: 0.29, trackW: 0.8, curve: 'twostroke', maxTorque: 21.5, idle: 1900, redline: 10800,
      gears: [0, 3.1, 2.25, 1.75, 1.42, 1.18, 1.0], final: 8.6, drag: 0.26, rollRes: 2, na: true, izMul: 3.0, cgH: 0.4,
      iWheel: 0.22, iEngine: 0.0035, ebMul: 0.04, launchRpm: 5600 },
    // Zipfer Märzen: fahrende Bierflasche, kurzer Radstand, kräftiger Sauger, sehr kurze Übersetzung -> spritzig, Spitze ca. 130 km/h
    zipfer: { mass: 1150, a: 1.02, b: 1.08, wheelR: 0.3, trackW: 1.36, curve: 'na6', maxTorque: 390, idle: 850, redline: 7300,
      gears: [0, 3.15, 2.28, 1.72, 1.34, 1.10, 0.92], final: 6.7, drag: 0.36 },
    // Ford Fusion ("Dreckshittn"): hoch, kurz, 1150 kg, Serienleistung (1.6: 100 PS / 146 Nm), 5-Gang-Getriebe iB5
    fusion: { mass: 1150, a: 1.05, b: 1.436, wheelR: 0.305, trackW: 1.45, curve: 'duratec', maxTorque: 146, idle: 800, redline: 6500,
      gears: [0, 3.58, 1.93, 1.28, 0.95, 0.76], final: 4.06, drag: 0.40, rollRes: 11, cgH: 0.58 },
    // Ford Focus Mk4 (2025) 1.0 EcoBoost Hybrid: 155 PS, 1360 kg, Radstand 2,70 m (60 % vorn), 6-Gang
    focus: { mass: 1360, a: 1.08, b: 1.62, wheelR: 0.322, trackW: 1.56, curve: 'ecoboost3', maxTorque: 210, idle: 800, redline: 6500,
      gears: [0, 3.73, 2.05, 1.36, 1.03, 0.82, 0.69], final: 4.06, drag: 0.38, rollRes: 12, cgH: 0.53 },
    // VW Polo 6R (2013) 1.2 TSI: 105 PS / 175 Nm, 1090 kg, Radstand 2,47 m, 6-Gang
    polo: { mass: 1090, a: 0.99, b: 1.48, wheelR: 0.30, trackW: 1.46, curve: 'tsi', maxTorque: 175, idle: 750, redline: 6200,
      gears: [0, 3.77, 2.09, 1.47, 1.10, 0.89, 0.73], final: 3.62, drag: 0.37, rollRes: 11, cgH: 0.54 },
    g31: { mass: 1840, a: 1.49, b: 1.485, wheelR: 0.335, trackW: 1.60, curve: 'diesel', maxTorque: 620, idle: 750, redline: 5000, gears: [0, 4.0, 2.5, 1.68, 1.28, 1.0, 0.80], final: 3.15, drag: 0.40, diesel: true }
  };
  // Motorvarianten je Auto (Index 0 = Serie). Werte überschreiben die Grunddaten oben.
  const ENGINES = {
    e46: [
      { key: 'e46', badge: '330i', name: '330i', code: 'M54 Reihensechser-Sauger' },
      { key: 'e46d', badge: '330d', name: '330d', code: 'M57 Reihensechser-Diesel', diesel: true,
        curve: 'diesel', maxTorque: 685, idle: 800, redline: 4800, final: 2.79, massAdd: 45 }
    ],
    f21: [{ key: 'f21', badge: 'M140i', name: 'M140i', code: 'B58 Reihensechser-Turbo' }],
    f31: [
      { key: 'f31', badge: '340i', name: '340i', code: 'B58 Reihensechser-Turbo' },
      { key: 'f31d', badge: '330d', name: '330d', code: 'N57 Reihensechser-Diesel', diesel: true,
        curve: 'diesel', maxTorque: 640, idle: 750, redline: 5000, final: 2.81, massAdd: 40 }
    ],
    g31: [
      { key: 'g31', badge: '530d', name: '530d', code: 'B57 Reihensechser-Diesel', diesel: true },
      { key: 'g31d4', badge: '520d', name: '520d', code: 'B47 Vierzylinder-Diesel', diesel: true,
        curve: 'diesel', maxTorque: 450, idle: 800, redline: 4800, final: 3.15, massAdd: -70 }
    ],
    wheelchair: [{ key: 'wheelchair', badge: '', name: "Jonny's Rollstuhl", code: 'Armkraft' }],
    rollator: [{ key: 'rollator', badge: '', name: 'Rollator', code: 'Elektromotor' }],
    tractor: [{ key: 'tractor', badge: '', name: 'Neiwirth', code: 'Vierzylinder-Turbodiesel', diesel: true }],
    moped: [
      { key: 'moped', badge: '', name: '2-Takt', code: 'Einzylinder-Zweitakter' },
      { key: 'moped4', badge: '4T', name: '4-Takt', code: 'Einzylinder-Viertakter', curve: 'fourstroke', maxTorque: 20, idle: 1500, redline: 9500, launchRpm: 4200 }
    ],
    fusion: [
      { key: 'fusion', badge: ' ', name: '1.6 16V', code: '1,6-l-Duratec-Vierzylinder' },
      { key: 'fusiond', badge: 'TDCi', name: '1.4 TDCi', code: '1,4-l-TDCi-Vierzylinder-Diesel', diesel: true,
        curve: 'diesel', maxTorque: 160, idle: 800, redline: 4600, final: 3.37, massAdd: 30 }
    ],
    focus: [
      { key: 'focus', badge: 'ST-LINE', name: '1.0 EcoBoost', code: '1,0-l-EcoBoost-Dreizylinder (Mildhybrid)' },
      { key: 'focusst', badge: 'ST', name: 'ST 2.3 EcoBoost', code: '2,3-l-EcoBoost-Vierzylinder-Turbo',
        curve: 'turbo', maxTorque: 390, idle: 850, redline: 6800, gears: [0, 3.31, 1.95, 1.33, 1.03, 0.82, 0.67], final: 3.82, massAdd: 140 }
    ],
    polo: [
      { key: 'polo', badge: 'TSI', name: '1.2 TSI', code: '1,2-l-TSI-Vierzylinder' },
      { key: 'pologti', badge: 'GTI', name: 'GTI 1.4 TSI', code: '1,4-l-TSI mit Kompressor und Turbo',
        curve: 'turbo', maxTorque: 250, idle: 800, redline: 6800, gears: [0, 3.5, 2.09, 1.47, 1.10, 0.89, 0.73], final: 3.94, massAdd: 100 },
      { key: 'polod', badge: 'TDI', name: '1.6 TDI', code: '1,6-l-TDI-Vierzylinder-Diesel', diesel: true,
        curve: 'diesel', maxTorque: 215, idle: 800, redline: 4800, final: 3.2, massAdd: 50 }
    ],
    zipfer: [{ key: 'zipfer', badge: '', name: 'Zipfer Märzen', code: 'Märzen-Reihensechser' }]
  };
  // gewählte Motorvariante aus der Garage-Konfiguration (cfg.engines = { modell: index })
  function engineOf(t) {
    const model = (t && t.model in ENGINES) ? t.model : 'e46', list = ENGINES[model];
    const i = (t && t.engines && t.engines[model]) | 0;
    return list[i] || list[0];
  }
  const TIRES = [
    { name: 'Straße', muF: 1.08, muR: 1.0, slide: 0.84, heat: 1.0 },
    { name: 'Semi-Slick', muF: 1.28, muR: 1.2, slide: 0.76, heat: 0.8 },
    { name: 'Drift-Reifen', muF: 1.06, muR: 0.9, slide: 0.92, heat: 1.35 },
    { name: 'Abgefahren', muF: 0.92, muR: 0.74, slide: 0.9, heat: 1.2 },
    // Rennreifen: sehr viel Grip, hinten mehr als vorne (Heck bleibt stabil), späterer Haftabriss,
    // und nach dem Abriss bleiben ~95 % Grip -> kaum Rutschen, zum Rennenfahren statt Driften
    { name: 'Rennreifen', muF: 1.6, muR: 1.75, slide: 0.95, heat: 0.6, spMul: 1.3 },
    // Klebereifen: 100 % Grip – nach dem Haftmaximum fällt die Kraft gar nicht mehr ab, nichts rutscht weg
    { name: 'Klebereifen', muF: 1.9, muR: 2.1, slide: 1.0, heat: 0.4, spMul: 1.5 }
  ];

  const P = {};
  function setBase(model, eng) {
    const m = Object.assign({}, MODELS[model] || MODELS.e46);
    if (eng) {
      for (const k of ['curve', 'maxTorque', 'idle', 'redline', 'final', 'gears', 'launchRpm']) if (eng[k] != null) m[k] = eng[k];
      if (eng.massAdd) m.mass += eng.massAdd;
      m.diesel = !!eng.diesel || !!m.diesel;
    }
    Object.assign(P, {
      model: model in MODELS ? model : 'e46', base: m,
      mass: m.mass, a: m.a, b: m.b, cgH: m.cgH || 0.5, wheelR: m.wheelR, trackW: m.trackW,
      gears: m.gears, final: m.final, eff: 0.88, idle: m.idle, redline: m.redline, maxTorque: m.maxTorque, curve: CURVES[m.curve], diesel: !!m.diesel, electric: !!m.electric, flames: !!m.flames,
      brake: 11000 * m.mass / 1420, brakeBias: 0.64, drag: m.drag, roll: m.rollRes || 14,
      maxSteer: 0.62, lock: 0.95, steerRate: 5.5,
      muF: 1.08, muR: 1.0, slide: 0.84, heat: 1.0, spMul: 1, loadSens: 0.11, relax: 0.42,
      hbTorque: 3200, lsd: 0.8, rollBiasF: 0.55, rollK: 1, pressF: 2.2, pressR: 2.2, turbo: 0,
      iWheel: m.iWheel || 2.6, iEngine: m.iEngine || 0.22
    });
    P.iz = 0.95 * P.mass * P.a * P.b * (P.base.izMul || 1);
  }
  setBase('e46');

  // Tuning aus der Garage übernehmen
  function applyTuning(t) {
    t = t || {};
    const k = (v, d) => (v == null || v === '' || isNaN(v)) ? d : +v;
    setBase(t.model || 'e46', engineOf(t));
    const m = P.base;
    P.maxTorque = m.maxTorque * k(t.power, 100) / 100;
    P.final = m.final * k(t.finalPct, 100) / 100;
    P.mass = m.mass * k(t.weightPct, 100) / 100;
    P.iz = 0.95 * P.mass * P.a * P.b * (P.base.izMul || 1);
    P.brake = 11000 * P.mass / 1420 * k(t.brakePower, 100) / 100;
    P.brakeBias = k(t.brakeBias, 64) / 100;
    P.lock = k(t.lock, 54) * Math.PI / 180;
    P.steerRate = 5.5 * k(t.steerSpeed, 100) / 100;
    const ti = TIRES[k(t.tires, 0) | 0] || TIRES[0];
    P.muF = ti.muF; P.muR = ti.muR; P.slide = ti.slide; P.heat = ti.heat; P.spMul = ti.spMul || 1;
    if (m.muRMul) P.muR *= m.muRMul;                              // fahrzeugeigene Drift-Abstimmung
    if (m.slideMin) P.slide = Math.max(P.slide, m.slideMin);
    P.hbTorque = 3200 * k(t.hbrake, 100) / 100;
    P.rollK = k(t.roll, 100) / 100;
    P.pressF = k(t.pressF, 2.2); P.pressR = k(t.pressR, 2.2);
    P.lsd = k(t.lsd, 80) / 100;
    P.rollBiasF = k(t.stabi, 55) / 100;
    P.turbo = k(t.turbo, 0) / 100;
    // Anti-Lag: nur mit Turbo (Serie oder Upgrade), nicht bei E-Antrieb
    P.hasTurbo = !P.electric && (P.turbo > 0 || (m.curve !== 'na6' && !m.na));
    P.als = !!t.als && P.hasTurbo;
    P.backfire = k(t.backfire, 100) / 100;   // Fehlzündungen: 0 = aus, 1 = Serie, 2 = sehr viel
  }
  function torque(rpm) {
    if (rpm > P.redline + 150) return 0;          // über der Abregeldrehzahl: kein Drehmoment
    const c = P.curve;
    if (rpm <= c[0][0]) return P.maxTorque * c[0][1];
    for (let i = 0; i < c.length - 1; i++) {
      if (rpm <= c[i + 1][0]) { const f = (rpm - c[i][0]) / (c[i + 1][0] - c[i][0]); return P.maxTorque * (c[i][1] + (c[i + 1][1] - c[i][1]) * f); }
    }
    return P.maxTorque * c[c.length - 1][1];
  }
  // Spitzenleistung in PS (inkl. voll aufgeladenem Turbo-Mod) für die Anzeige
  function peakPS() {
    let best = 0;
    for (let r = 1000; r <= P.redline; r += 50) best = Math.max(best, torque(r) * (1 + P.turbo * 0.45 * Math.min(1, Math.max(0, (r - 2200) / 2000))) * r / 9549);
    return Math.round(best * 1.36);
  }

  // Reifenkennlinie: Anstieg bis zum Haftmaximum bei sp, danach Abfall auf Gleitwert
  function curve(s, sp, slide) {
    if (s <= sp) { const q = s / sp; return q * (2 - q); }
    return slide + (1 - slide) * Math.exp(-(s - sp) / 0.32);
  }
  // Grip-Faktor durch Reifentemperatur (optimal ~85 °C)
  const tempGrip = (T) => 0.9 + 0.1 * Math.exp(-Math.pow((T - 85) / 42, 2));
  // Druck: optimal 2,1 bar; weniger Druck = weicher, später Haftabriss
  const pressMu = (p) => 1 - 0.07 * Math.pow((p - 2.1) / 0.6, 2);
  const pressSp = (p) => Math.max(0.07, 0.115 + (2.2 - p) * 0.035);

  class Car {
    constructor() { this.reset(0, 0, 0); this.assist = 0.7; this.auto = true; this.maxAngle = 0.95; }
    reset(x, z, h) {
      Object.assign(this, {
        x, z, h, vx: 0, vz: 0, r: 0, steer: 0, steerIn: 0,
        gear: 1, rpm: P.idle, spin: 0, wr: 0, shiftT: 0, axLong: 0, ayLat: 0,
        u: 0, w: 0, beta: 0, slipR: 0, slipF: 0, throttle: 0, brakeIn: 0, hb: 0,
        frontSpin: 0, rearSpin: 0, revCut: false, limiter: 0, reverse: false, lastThrottle: 0, backfire: 0, alsPop: 0,
        roll: 0, pitch: 0, rollV: 0, pitchV: 0, trackIdx: -1, lateral: 0,
        aF: 0, aR: 0, tempF: 45, tempR: 45, boost: 0, blowoff: false, fuelPuff: 0, donut: 0, grade: 0, groundY: 0
      });
    }
    get speed() { return Math.hypot(this.vx, this.vz); }

    step(dt, inp) {
      const fx = Math.cos(this.h), fz = -Math.sin(this.h), rx = Math.sin(this.h), rz = Math.cos(this.h);
      let u = this.vx * fx + this.vz * fz;      // längs
      let w = this.vx * rx + this.vz * rz;      // quer (+ = nach rechts)
      const spd = Math.hypot(u, w);
      const L = P.a + P.b, R = P.wheelR;

      // ---- Eingaben ----
      const thrIn = inp.throttle, brkIn = inp.brake, hbIn = inp.handbrake ? 1 : 0;
      this.throttle += (thrIn - this.throttle) * Math.min(1, dt * 12);
      this.brakeIn += (brkIn - this.brakeIn) * Math.min(1, dt * 14);
      this.hb = hbIn;
      if (brkIn > 0.5 && u < 0.6 && thrIn < 0.1) this.reverse = true;
      if (thrIn > 0.1 && u > -0.5) this.reverse = false;

      // ---- Donut-Erkennung: langsam, voll eingeschlagen, Vollgas, Hinterräder drehen durch ----
      // dann kein Gegenlenken, voller Lenkeinschlag, kaum Gierdämpfung und kein Winkel-Stabilisator
      const donutWant = thrIn > 0.6 && Math.abs(inp.steer) > 0.7 && spd < 15 && !this.reverse && this.wr - u > 2.5;
      this.donut += ((donutWant ? 1 : 0) - this.donut) * Math.min(1, dt * (donutWant ? 2.5 : 1.2));
      const dn = this.donut;

      // ---- Lenkung mit automatischem Gegenlenken ----
      const uAbs = Math.max(Math.abs(u), 2.5);
      const vFront = w - P.a * this.r;
      const align = -Math.atan2(vFront, Math.max(Math.abs(u), 2.0)) * (u >= 0 ? 1 : -1);
      const speedK = Math.min(1, spd / 30);
      const maxIn = P.maxSteer * (1 - 0.42 * speedK) * (1 - dn) + P.lock * dn;
      this.steerIn += (inp.steer - this.steerIn) * Math.min(1, dt * 9);
      let target = this.steerIn * maxIn + (spd > 3 ? align * this.assist * (1 - dn) : 0);
      target = Math.max(-P.lock, Math.min(P.lock, target));
      this.steer += Math.max(-P.steerRate * dt, Math.min(P.steerRate * dt, target - this.steer));
      const d = this.steer;

      // ---- Radlasten (längs + quer) ----
      const wt = P.mass * G;
      let Nf = wt * P.b / L - P.mass * this.axLong * P.cgH / L;
      let Nr = wt * P.a / L + P.mass * this.axLong * P.cgH / L;
      Nf = Math.max(wt * 0.15, Nf); Nr = Math.max(wt * 0.15, Nr);
      const dLat = P.mass * Math.abs(this.ayLat) * P.cgH / P.trackW;    // gesamte Querlastverlagerung
      const N0 = wt / 4;
      // Achs-Grip aus zwei Rädern mit lastabhängigem Reibwert
      const axle = (N, dN) => {
        const nIn = Math.max(0, N / 2 - dN), nOut = N / 2 + dN;
        const mu = (n) => Math.max(0.5, 1 - P.loadSens * (n / N0 - 1));
        return { grip: mu(nIn) * nIn + mu(nOut) * nOut, inner: mu(nIn) * nIn };
      };
      const gF = axle(Nf, dLat * P.rollBiasF), gR = axle(Nr, dLat * (1 - P.rollBiasF));
      const muF = P.muF * tempGrip(this.tempF) * pressMu(P.pressF);
      const muR = P.muR * tempGrip(this.tempR) * pressMu(P.pressR);
      const FmaxF = muF * gF.grip, FmaxR = muR * gR.grip;
      const spF = pressSp(P.pressF) * P.spMul, spR = pressSp(P.pressR) * P.spMul;

      // ---- Schräglauf mit Einlaufverzögerung ----
      const wl = u * Math.cos(d) - vFront * Math.sin(d);
      const wq = vFront * Math.cos(d) + u * Math.sin(d);
      const alphaF = Math.atan2(wq, Math.max(Math.abs(wl), 2.0));
      const vRear = w + P.b * this.r;
      const alphaR = Math.atan2(vRear, uAbs);
      const relaxK = Math.min(1, (Math.abs(u) + 4) * dt / P.relax);
      this.aF += (alphaF - this.aF) * relaxK;
      this.aR += (alphaR - this.aR) * relaxK;

      // ---- Motor / Kupplung ----
      this.shiftT = Math.max(0, this.shiftT - dt);
      const gearR = this.reverse ? -3.4 : P.gears[this.gear];
      const gr = gearR * P.final;
      const engaged = this.shiftT <= 0;
      const rpmWheel = Math.abs(this.wr) / R * Math.abs(gr) * 60 / (2 * Math.PI);
      const thrUse = this.reverse ? this.brakeIn : this.throttle;
      // Kupplung schleift beim Anfahren -> Motor bleibt auf Drehzahl
      const launch = P.idle + thrUse * (P.base.launchRpm || (P.diesel ? 1400 : 2600));
      let engRpm = engaged ? Math.max(rpmWheel, thrUse > 0.05 ? Math.min(launch, P.redline) : P.idle) : this.rpm;
      // Drehzahlbegrenzer: Schnitt über Höchstdrehzahl, Freigabe erst ~150 U/min darunter (Begrenzer-Stottern)
      if (rpmWheel > P.redline) this.revCut = true;
      else if (rpmWheel < P.redline - 150) this.revCut = false;
      if (this.revCut) this.limiter += dt; else this.limiter = Math.max(0, this.limiter - dt * 2);
      // 2-Step: Anti-Lag + Handbremse + Gas im Stand -> Kupplung offen, Motor stottert am Startdrehzahl-Begrenzer
      const twoStep = P.als && this.hb && thrIn > 0.5 && spd < 2.5 && !this.reverse;
      this.twoStep = twoStep;
      if (twoStep) {
        const lr = P.diesel ? Math.min(P.redline - 500, 3300) : Math.min(P.redline - 1200, 5000);
        this.tsT = (this.tsT || 0) + dt;
        const cutNow = (this.tsT * 19 + Math.sin(this.tsT * 7) * 0.3) % 1 < 0.38;   // unregelmäßiges Begrenzer-Stottern
        engRpm = lr - (cutNow ? 280 : 0);
        this.revCut = cutNow;
      }
      // Turbo-Ladedruck mit Verzögerung
      let boostT = thrUse * Math.min(1, Math.max(0, (engRpm - 2200) / 2000));
      // Anti-Lag: im Schub wird weiter verbrannt -> Lader bleibt auf Drehzahl, kein Turboloch
      const alsOn = P.als && (twoStep || engRpm > Math.max(2400, P.idle * 2.2));
      if (alsOn) boostT = Math.max(boostT, twoStep ? 1 : 0.9);
      const prevBoost = this.boost;
      this.boost += (boostT - this.boost) * Math.min(1, dt * (boostT > this.boost ? (P.als ? 4 : 1.6) : 5));
      this.blowoff = !P.als && P.hasTurbo && prevBoost > 0.55 && this.lastThrottle > 0.5 && thrIn < 0.2;
      // Knallen im Schub (Anti-Lag): solange kaum Gas und genug Drehzahl
      this.alsPop = twoStep ? 1 : (alsOn && thrIn < 0.15 ? Math.min(1, (engRpm - 2400) / 3000 + 0.4) : 0);
      const thr = this.revCut ? 0 : thrUse;
      let Tdrive = 0;
      if (engaged) {
        const tq = torque(engRpm) * (1 + P.turbo * 0.45 * this.boost);
        Tdrive = thr * tq * gr * P.eff;
        // Motorbremse (Schubabschaltung), steigt mit der Drehzahl
        if ((thr < 0.05 || this.revCut) && rpmWheel > P.idle * 1.3) Tdrive -= Math.sign(this.wr) * (28 + rpmWheel * 0.011) * Math.abs(gr) * (P.diesel ? 1.25 : 1) * (P.als ? 0.45 : 1) * (P.base.ebMul || 1);
      }
      if (twoStep) Tdrive = 0;
      const Ieff = P.iWheel + (engaged && rpmWheel > P.idle * 0.9 ? P.iEngine * gr * gr * P.eff : 0);

      // ---- Bremsen ----
      let brakeFront = 0, Tb = 0;
      if (!this.reverse && this.brakeIn > 0.01) {
        brakeFront = this.brakeIn * P.brake * P.brakeBias;
        Tb = this.brakeIn * P.brake * (1 - P.brakeBias) * R;
      }
      if (u < -0.3 && thrIn > 0.1) brakeFront = thrIn * P.brake * 0.7;
      if (this.hb) Tb += P.hbTorque;

      // ---- Hinterachse: kombinierter Schlupf, Raddrehzahl halb-implizit ----
      const sy = Math.tan(Math.max(-1.35, Math.min(1.35, this.aR)));
      const rearForce = (wr) => {
        // offenes Diff: nur das entlastete Innenrad dreht durch, das äußere behält Seitenführung
        const kap = (wr - u) / uAbs * (0.3 + 0.7 * P.lsd);
        const s = Math.hypot(kap, sy);
        if (s < 1e-6) return { fx: 0, fy: 0, s: 0 };
        const F = FmaxR * curve(s, spR, P.slide);
        let fxr = F * kap / s;
        // offenes Differenzial: Antriebskraft durch das entlastete Innenrad begrenzt
        if (fxr > 0) {
          const cap = (2 * muR * gR.inner) * (1 - P.lsd) + FmaxR * P.lsd;
          if (fxr > cap) fxr = cap;
        }
        return { fx: fxr, fy: -F * sy / s, s };
      };
      let wr = this.wr;
      const f0 = rearForce(wr), f1 = rearForce(wr + 0.02);
      const kDer = Math.max(0, (f1.fx - f0.fx) / 0.02);
      const Tbrake = Tb * (Math.abs(wr) > 0.05 ? Math.sign(wr) : 0);
      let wrNew = wr + dt * R * (Tdrive - Tbrake - f0.fx * R) / Ieff / (1 + dt * R * R * kDer / Ieff);
      // Bremse/Handbremse blockiert: Rad bleibt stehen, solange das Bremsmoment reicht
      if (Tb > 0 && ((wr > 0 && wrNew < 0) || (wr < 0 && wrNew > 0) || (Math.abs(wr) <= 0.05 && Math.abs(Tdrive - f0.fx * R) < Tb))) wrNew = 0;
      const rf = rearForce(wrNew);
      this.wr = wrNew;
      const FxR = rf.fx, FyR = rf.fy;

      // ---- Vorderachse (frei rollend, ABS) ----
      const FyFraw = -FmaxF * curve(Math.abs(this.aF) * 1.0, spF * 1.15, Math.max(P.slide, Math.min(0.95, P.slide + 0.06))) * Math.sign(this.aF);
      let FxF = 0;
      if (brakeFront > 0 && Math.abs(u) > 0.2) FxF = -Math.sign(u) * Math.min(brakeFront, FmaxF * 0.98);
      const capF = Math.sqrt(Math.max(0, FmaxF * FmaxF - FxF * FxF));
      const FyF = Math.max(-capF, Math.min(capF, FyFraw));

      // ---- Kräfte im Fahrzeugsystem ----
      let Fl = FxR + FxF * Math.cos(d) + FyF * Math.sin(d);
      let Fq = FyR + FyF * Math.cos(d) - FxF * Math.sin(d);
      Fl -= P.drag * u * Math.abs(u) + P.roll * u;
      Fq -= P.drag * w * Math.abs(w) * 0.5;
      Fl -= P.mass * G * (this.grade || 0);      // Rampe/Brücke: Hangabtrieb (Steigung von außen, siehe Track.gradeAt)
      const torqueY = -P.a * (FyF * Math.cos(d) - FxF * Math.sin(d)) + P.b * FyR;

      // Stillstand stabilisieren
      if (spd < 1.2 && thrIn < 0.05 && !this.reverse && Math.abs(this.wr) < 1) {
        const k = Math.min(1, dt * 5);
        u -= u * k; w -= w * k; this.r -= this.r * k * 2; this.wr -= this.wr * k;
        Fl = 0; Fq = 0;
      }

      const al = Fl / P.mass, aq = Fq / P.mass;
      u += al * dt; w += aq * dt;
      this.r += torqueY / P.iz * dt;
      this.r *= 1 - Math.min(0.5, dt * (spd < 5 ? 3 - 2.85 * dn : 0.12));

      // Drift-Stabilisator (weiche Winkelgrenze, Arcade-Feeling)
      if (spd > 4 && u > 0) {
        const b = Math.atan2(w, u), ex = Math.abs(b) - this.maxAngle - dn * 0.9;
        if (ex > 0) this.r -= Math.sign(b) * ex * 14 * dt * (0.5 + this.assist);
      }
      this.h += this.r * dt;
      this.vx = fx * u + rx * w; this.vz = fz * u + rz * w;
      this.x += this.vx * dt; this.z += this.vz * dt;

      this.axLong += (al - this.axLong) * Math.min(1, dt * 8);
      this.ayLat += ((Fq / P.mass) - this.ayLat) * Math.min(1, dt * 6);

      // ---- Reifentemperatur ----
      const slipVR = Math.hypot(this.wr - u, vRear), slipVF = Math.abs(wq) + Math.abs(FxF) / Math.max(1, FmaxF) * 2;
      const amb = 25, cool = 0.09 + spd * 0.004;
      this.tempR += (Math.hypot(FxR, FyR) * slipVR * 1.0e-4 * P.heat - (this.tempR - amb) * cool) * dt;
      this.tempF += (Math.hypot(FyF, FxF) * slipVF * 0.8e-4 * P.heat - (this.tempF - amb) * cool) * dt;

      // ---- Drehzahl & Getriebe ----
      const rpmNow = twoStep ? engRpm : engaged ? Math.max(Math.abs(this.wr) / R * Math.abs(gr) * 60 / (2 * Math.PI), thrUse > 0.05 ? Math.min(launch, P.redline) : P.idle) : P.idle + thrUse * 2500;
      this.rpm += (Math.min(P.redline + 80, rpmNow) - this.rpm) * Math.min(1, dt * (engaged ? 18 : 8));
      const spinning = this.wr - u > 2.5;
      const wheelRpmGround = Math.abs(u) / R * P.gears[this.gear] * P.final * 60 / (2 * Math.PI);
      const upAt = P.redline - (P.electric ? 1100 : 400);   // E-Antrieb: früher schalten (leichte Fahrzeuge brauchen viel Schlupf)
      if (this.auto && !this.reverse && this.shiftT <= 0) {
        if ((wheelRpmGround > upAt || (this.limiter > 0.3 && this.gear < 3)) && this.gear < P.gears.length - 1 && !(spinning && this.gear >= 3 && !P.electric)) { this.gear++; this.shiftT = 0.18; this.limiter = 0; }
        else if (this.gear > 1 && !spinning) {
          const lower = Math.abs(u) / R * P.gears[this.gear - 1] * P.final * 60 / (2 * Math.PI);
          if (wheelRpmGround < P.redline * 0.41 && lower < P.redline * 0.82 && (this.gear > 2 || spd < 6)) { this.gear--; this.shiftT = 0.12; this.downshifts = (this.downshifts || 0) + 1; }
        }
      }
      if (inp.shiftUp && this.gear < P.gears.length - 1) { this.gear++; this.shiftT = 0.08; this.limiter = 0; }
      if (inp.shiftDown && this.gear > 1) {
        // nur runterschalten, wenn der Motor im kleineren Gang nicht überdreht
        const rpmLower = Math.abs(u) / R * P.gears[this.gear - 1] * P.final * 60 / (2 * Math.PI);
        if (rpmLower < P.redline + 250) { this.gear--; this.shiftT = 0.06; this.downshifts = (this.downshifts || 0) + 1; }
        else this.shiftDenied = 0.6;
      }
      this.shiftDenied = Math.max(0, (this.shiftDenied || 0) - dt);

      // Fehlzündung beim Gaswegnehmen (Benziner und Jonnys Rollstuhl, der spuckt trotz E-Motor Feuer), Rußstoß beim Gasgeben (Diesel)
      // Regler „Fehlzündungen“: mehr = schon bei weniger Drehzahl/Gas, mehr Nachschüsse
      const bf = P.backfire == null ? 1 : P.backfire;
      if (bf > 0 && !P.diesel && (!P.electric || P.flames) && this.lastThrottle > 0.7 - 0.15 * bf && thrIn < 0.2 && this.rpm > P.redline * Math.max(0.45, 0.8 - 0.15 * bf))
        this.backfire = Math.max(1, Math.round((3 + (Math.random() * 3 | 0)) * bf));
      if (P.diesel && thrIn > 0.6 && this.lastThrottle < 0.3) this.fuelPuff = 1;
      this.fuelPuff = Math.max(0, this.fuelPuff - dt * 1.4);
      this.lastThrottle = thrIn;

      // ---- Zustände für Darstellung ----
      this.u = u; this.w = w;
      this.spin = this.wr - u;
      this.beta = spd > 3 ? Math.atan2(w, Math.abs(u)) : 0;
      this.slipR = slipVR;
      this.slipF = Math.abs(wq) * (Math.abs(alphaF) > 0.25 ? 1 : 0);
      this.frontSpin = u / R * dt;
      this.rearSpin = this.wr / R * dt;

      // Karosseriebewegung
      const rollT = Math.max(-0.11, Math.min(0.11, this.ayLat * -0.0105 * P.rollK));
      const pitchT = Math.max(-0.06, Math.min(0.06, this.axLong * 0.0055 * P.rollK));
      this.rollV += ((rollT - this.roll) * 90 - this.rollV * 11) * dt; this.roll += this.rollV * dt;
      this.pitchV += ((pitchT - this.pitch) * 110 - this.pitchV * 12) * dt; this.pitch += this.pitchV * dt;
    }
  }

  window.Physics = { Car, P, TIRES, MODELS, ENGINES, engineOf, applyTuning, peakPS };
})();
