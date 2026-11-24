// Jumpscare vom Admin: Vollbild-Fratze mit Blitzen, Wackeln und lautem Schrei (~2,5 s)
(function () {
  let busy = false;

  // Fratze auf ein Canvas malen (bleiches Gesicht, leere Augen, aufgerissener Mund)
  function drawFace(c, t) {
    const W = c.width, H = c.height, g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const s = Math.min(W, H) / 1000, cx = W / 2 + (Math.random() - 0.5) * 30 * s, cy = H / 2 + (Math.random() - 0.5) * 30 * s;
    const zoom = 1 + t * 0.35;   // kommt auf dich zu
    g.save(); g.translate(cx, cy); g.scale(s * zoom, s * zoom);
    // Gesicht
    const skin = g.createRadialGradient(0, -60, 50, 0, 0, 520);
    skin.addColorStop(0, '#e9e4d8'); skin.addColorStop(0.6, '#a9a497'); skin.addColorStop(1, '#2a2622');
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(0, 0, 360, 470, 0, 0, Math.PI * 2); g.fill();
    // Augenhöhlen
    for (const x of [-140, 140]) {
      const e = g.createRadialGradient(x, -110, 10, x, -110, 130);
      e.addColorStop(0, '#000'); e.addColorStop(0.65, '#000'); e.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = e; g.beginPath(); g.ellipse(x, -110, 130, 115, x < 0 ? 0.25 : -0.25, 0, Math.PI * 2); g.fill();
      // glühende Pupille
      const p = g.createRadialGradient(x, -105, 0, x, -105, 26);
      p.addColorStop(0, '#fff'); p.addColorStop(0.3, '#ff2020'); p.addColorStop(1, 'rgba(255,0,0,0)');
      g.fillStyle = p; g.beginPath(); g.arc(x, -105, 26, 0, Math.PI * 2); g.fill();
      // Blutspur
      g.fillStyle = '#6d0000';
      g.beginPath(); g.moveTo(x - 14, -30); g.quadraticCurveTo(x - 4, 80, x - 10, 160 + Math.random() * 20); g.lineTo(x + 6, 160); g.quadraticCurveTo(x + 4, 60, x + 14, -30); g.fill();
    }
    // Nase
    g.fillStyle = '#111';
    g.beginPath(); g.moveTo(-30, 70); g.lineTo(0, 10); g.lineTo(30, 70); g.closePath(); g.fill();
    // Mund (weit aufgerissen, wackelt)
    const mo = 1 + Math.sin(t * 60) * 0.06;
    g.fillStyle = '#120000';
    g.beginPath(); g.ellipse(0, 260, 190 * mo, 150 * mo, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a0000';
    g.beginPath(); g.ellipse(0, 300, 120 * mo, 70 * mo, 0, 0, Math.PI * 2); g.fill();
    // Zähne
    g.fillStyle = '#e8e2c0';
    for (let i = -6; i <= 6; i++) {
      const x = i * 27 * mo, top = 260 - 150 * mo * Math.sqrt(Math.max(0, 1 - (x / (190 * mo)) ** 2)), bot = 260 + 150 * mo * Math.sqrt(Math.max(0, 1 - (x / (190 * mo)) ** 2));
      g.beginPath(); g.moveTo(x - 12, top); g.lineTo(x, top + 55); g.lineTo(x + 12, top); g.fill();
      g.beginPath(); g.moveTo(x - 12, bot); g.lineTo(x, bot - 50); g.lineTo(x + 12, bot); g.fill();
    }
    g.restore();
    // Rauschen / Störstreifen
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,0,0' : '255,255,255'},${Math.random() * 0.12})`;
      g.fillRect(0, Math.random() * H, W, 2 + Math.random() * 18 * s);
    }
  }

  // Lauter Schrei mit WebAudio (geht am Master-Regler vorbei direkt auf die Boxen)
  function scream() {
    const S = window.Sound;
    let ctx = S && S.ctx;
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime, dur = 2.2;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(1, t0 + 0.02);
    out.gain.setValueAtTime(1, t0 + dur - 0.4); out.gain.linearRampToValueAtTime(0, t0 + dur);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 8;
    out.connect(comp); comp.connect(ctx.destination);
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve; shaper.connect(out);
    // Schreiende Stimmen: Sägezahn mit schnellem Vibrato, Tonhöhe kippt nach oben und fällt
    for (const [f, det] of [[620, 0], [930, 12], [1240, -9], [470, 5]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.setValueAtTime(f * 0.7, t0); o.frequency.exponentialRampToValueAtTime(f * 1.25, t0 + 0.25);
      o.frequency.exponentialRampToValueAtTime(f * 0.8, t0 + dur);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9 + Math.random() * 5; lg.gain.value = f * 0.06;
      lfo.connect(lg); lg.connect(o.frequency);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0.22;
      o.connect(bp); bp.connect(g); g.connect(shaper);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    }
    // Rausch-Knall am Anfang + Kratzen
    const nb = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (i < ctx.sampleRate * 0.25 ? 1 : 0.35);
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    ns.connect(hp); hp.connect(ng); ng.connect(shaper); ns.start(t0);
    // tiefer Schlag
    const kick = ctx.createOscillator(), kg = ctx.createGain(); kick.type = 'sine';
    kick.frequency.setValueAtTime(120, t0); kick.frequency.exponentialRampToValueAtTime(35, t0 + 0.5);
    kg.gain.setValueAtTime(1, t0); kg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    kick.connect(kg); kg.connect(out); kick.start(t0); kick.stop(t0 + 0.6);
    if (S && S.setDuck) { S.setDuck(0.05); setTimeout(() => S.setDuck(1), dur * 1000); }
  }

  function play() {
    if (busy) return; busy = true;
    const dur = 2500;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;pointer-events:all;overflow:hidden';
    const c = document.createElement('canvas');
    c.width = innerWidth; c.height = innerHeight;
    c.style.cssText = 'width:100%;height:100%;display:block';
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;mix-blend-mode:difference;opacity:0';
    wrap.appendChild(c); wrap.appendChild(flash); document.body.appendChild(wrap);
    try { scream(); } catch (e) { /* kein Ton */ }
    if (navigator.vibrate) try { navigator.vibrate([400, 80, 400, 80, 600]); } catch (e) { /* */ }
    const start = performance.now();
    (function frame(now) {
      const t = (now - start) / 1000;
      drawFace(c, t);
      const k = Math.max(0, 1 - t / 2.5), sh = 40 * k;
      c.style.transform = `translate(${(Math.random() - 0.5) * sh}px,${(Math.random() - 0.5) * sh}px) rotate(${(Math.random() - 0.5) * 4 * k}deg)`;
      flash.style.opacity = t < 0.08 || Math.random() < 0.12 ? 1 : 0;
      wrap.style.filter = Math.random() < 0.15 ? 'invert(1) hue-rotate(180deg)' : '';
      if (now - start < dur) requestAnimationFrame(frame);
      else { wrap.remove(); busy = false; }
    })(start);
  }

  // ---------- Jumpscare 2 ("viel ärger"): Spannungsaufbau, Stille, dann Totalausfall (~8 s) ----------

  // Gruseliger Aufbau: tiefes Dröhnen, immer schneller werdender Herzschlag, Flüstern
  function dread(ctx, out, t0, dur) {
    // Drone: zwei verstimmte tiefe Sägezähne durch Tiefpass, wird lauter
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, t0); lp.frequency.linearRampToValueAtTime(600, t0 + dur);
    const dg = ctx.createGain(); dg.gain.setValueAtTime(0, t0); dg.gain.linearRampToValueAtTime(0.35, t0 + dur - 0.05); dg.gain.linearRampToValueAtTime(0, t0 + dur);
    lp.connect(dg); dg.connect(out);
    for (const f of [41, 43.3, 61.7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * 1.5, t0 + dur);
      o.connect(lp); o.start(t0); o.stop(t0 + dur);
    }
    // Herzschlag: Abstand schrumpft von 0,9 s auf 0,25 s
    let t = t0 + 0.2, gap = 0.9;
    while (t < t0 + dur - 0.1) {
      for (const [dt, v] of [[0, 1], [0.16, 0.7]]) {
        const k = ctx.createOscillator(), kg = ctx.createGain(); k.type = 'sine';
        k.frequency.setValueAtTime(70, t + dt); k.frequency.exponentialRampToValueAtTime(30, t + dt + 0.18);
        kg.gain.setValueAtTime(0.0001, t + dt); kg.gain.exponentialRampToValueAtTime(0.9 * v, t + dt + 0.01); kg.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.22);
        k.connect(kg); kg.connect(out); k.start(t + dt); k.stop(t + dt + 0.25);
      }
      t += gap; gap = Math.max(0.25, gap * 0.8);
    }
    // Flüstern: gefiltertes Rauschen, das an- und abschwillt
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 3;
    const wg = ctx.createGain(); wg.gain.value = 0;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 3.3; lg.gain.value = 0.12;
    lfo.connect(lg); lg.connect(wg.gain);
    ns.connect(bp); bp.connect(wg); wg.connect(out); ns.start(t0); lfo.start(t0); lfo.stop(t0 + dur);
  }

  // Der eigentliche Knall: mehr Stimmen, tiefer + höher, härter verzerrt, länger
  function scream2(ctx, out, t0, dur) {
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 14); }
    shaper.curve = curve; shaper.connect(out);
    const voices = [[180, 0], [310, 7], [620, 0], [930, 12], [1240, -9], [1870, 15], [470, 5], [2600, -20]];
    for (const [f, det] of voices) {
      const o = ctx.createOscillator(); o.type = Math.random() < 0.5 ? 'sawtooth' : 'square'; o.detune.value = det;
      o.frequency.setValueAtTime(f * 0.5, t0); o.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + 0.18);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t0 + dur * 0.6); o.frequency.exponentialRampToValueAtTime(f * 1.6, t0 + dur);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 6 + Math.random() * 14; lg.gain.value = f * 0.1;
      lfo.connect(lg); lg.connect(o.frequency);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.18;
      o.connect(bp); bp.connect(g); g.connect(shaper);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    }
    // Rauschwand
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (i < ctx.sampleRate * 0.35 ? 1 : 0.5);
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const ng = ctx.createGain(); ng.gain.value = 0.6;
    ns.connect(hp); hp.connect(ng); ng.connect(shaper); ns.start(t0);
    // Mehrere tiefe Schläge
    for (const dt of [0, 0.45, 0.9, 1.6, 2.4]) {
      const k = ctx.createOscillator(), kg = ctx.createGain(); k.type = 'sine';
      k.frequency.setValueAtTime(140, t0 + dt); k.frequency.exponentialRampToValueAtTime(28, t0 + dt + 0.6);
      kg.gain.setValueAtTime(1.2, t0 + dt); kg.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.7);
      k.connect(kg); kg.connect(out); k.start(t0 + dt); k.stop(t0 + dt + 0.7);
    }
  }

  function audio2(buildDur, gapDur, hitDur) {
    const S = window.Sound;
    let ctx = S && S.ctx;
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime, tHit = t0 + buildDur + gapDur;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -4; comp.ratio.value = 12; comp.connect(ctx.destination);
    const out = ctx.createGain(); out.connect(comp);
    out.gain.setValueAtTime(1, t0);
    out.gain.setValueAtTime(1, tHit + hitDur - 0.5); out.gain.linearRampToValueAtTime(0, tHit + hitDur);
    dread(ctx, out, t0, buildDur);
    scream2(ctx, out, tHit, hitDur);
    const total = buildDur + gapDur + hitDur;
    if (S && S.setDuck) { S.setDuck(0.0); setTimeout(() => S.setDuck(1), total * 1000); }
  }

  // Zerhackt das Bild in horizontale Streifen und verschiebt sie (Glitch)
  function glitch(c, amount) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const n = 3 + Math.floor(Math.random() * 6 * amount);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * H, h = 4 + Math.random() * H * 0.08, dx = (Math.random() - 0.5) * W * 0.25 * amount;
      try { g.drawImage(c, 0, y, W, h, dx, y, W, h); } catch (e) { /* */ }
    }
  }

  let busy2 = false;
  function play2() {
    if (busy2 || busy || busy3) return; busy2 = true;
    const BUILD = 4.2, GAP = 0.6, HIT = 3.6, total = (BUILD + GAP + HIT) * 1000;
    const host = document.fullscreenElement || document.body;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:all;overflow:hidden;background:rgba(0,0,0,0)';
    const c = document.createElement('canvas');
    c.width = innerWidth; c.height = innerHeight;
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0';
    const msg = document.createElement('div');
    msg.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#b00000;font:900 clamp(28px,7vw,120px)/1.1 Georgia,serif;text-align:center;opacity:0;text-shadow:0 0 18px #f00;letter-spacing:.06em;padding:5vw;box-sizing:border-box';
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;mix-blend-mode:difference;opacity:0';
    const red = document.createElement('div');
    red.style.cssText = 'position:absolute;inset:0;background:#f00;mix-blend-mode:multiply;opacity:0';
    wrap.append(c, red, msg, flash); host.appendChild(wrap);
    try { audio2(BUILD, GAP, HIT); } catch (e) { /* kein Ton */ }
    const lines = ['du bist nicht allein', 'dreh dich nicht um', 'ER SITZT HINTER DIR'];
    const start = performance.now();
    let vibed = false;
    (function frame(now) {
      const t = (now - start) / 1000;
      if (t < BUILD) {
        // Bild wird dunkler, rote Vignette, flackernde Sätze
        const k = t / BUILD;
        wrap.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,${0.35 + k * 0.5}) 0%, rgba(40,0,0,${0.6 + k * 0.4}) 100%)`;
        const li = Math.min(lines.length - 1, Math.floor(k * lines.length));
        msg.textContent = lines[li];
        msg.style.opacity = Math.random() < 0.08 + k * 0.2 ? 0 : (0.25 + k * 0.75);
        msg.style.transform = `translate(${(Math.random() - 0.5) * 8 * k}px,${(Math.random() - 0.5) * 8 * k}px) scale(${1 + k * 0.25})`;
        // kurze unterschwellige Gesichtsblitze gegen Ende
        if (k > 0.55 && Math.random() < 0.04) { c.style.opacity = 0.5; drawFace(c, 0); } else c.style.opacity = 0;
      } else if (t < BUILD + GAP) {
        // totale Stille + Schwarz
        wrap.style.background = '#000'; msg.style.opacity = 0; c.style.opacity = 0;
      } else {
        const h = t - BUILD - GAP, k = Math.max(0, 1 - h / HIT);
        if (!vibed) { vibed = true; if (navigator.vibrate) try { navigator.vibrate([600, 60, 600, 60, 900, 60, 900]); } catch (e) { /* */ } }
        c.style.opacity = 1;
        drawFace(c, h * 2.2);           // rast viel schneller auf dich zu
        glitch(c, 0.5 + k);
        // ab und zu erscheint der Text noch mal riesig mitten im Schrei
        if (Math.random() < 0.1) { msg.textContent = 'ER SITZT HINTER DIR'; msg.style.opacity = 1; msg.style.color = '#fff'; } else msg.style.opacity = 0;
        const sh = 70 * k;
        c.style.transform = `translate(${(Math.random() - 0.5) * sh}px,${(Math.random() - 0.5) * sh}px) rotate(${(Math.random() - 0.5) * 8 * k}deg) scale(${1 + Math.random() * 0.15})`;
        red.style.opacity = Math.random() < 0.35 ? 0.85 : 0;
        flash.style.opacity = h < 0.1 || Math.random() < 0.15 ? 1 : 0;
        wrap.style.filter = Math.random() < 0.18 ? 'invert(1) hue-rotate(180deg) contrast(2)' : (Math.random() < 0.15 ? 'contrast(3) saturate(3)' : '');
      }
      if (now - start < total) requestAnimationFrame(frame);
      else { wrap.remove(); busy2 = false; }
    })(start);
  }

  // ---------- Jumpscare 3 "ALBTRAUM": Figur kommt bei jedem Lichtflackern näher, dann Monstergesicht (~14 s) ----------

  // fester Zufall, damit Risse/Adern nicht jedes Bild springen
  function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  // Die Gestalt: viel zu groß, dürr, Arme bis unter die Knie, Kopf schief, Grinsen
  function drawCreature(g, W, H, size, tilt, light, twitch) {
    const s = H / 1000 * size, x0 = W / 2 + twitch * 6 * s, y0 = H * 0.62 + 380 * s;
    g.save(); g.translate(x0, y0); g.scale(s, s);
    const skin = `rgb(${200 * light | 0},${195 * light | 0},${185 * light | 0})`, dark = `rgb(${40 * light | 0},${35 * light | 0},${32 * light | 0})`;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Beine (dünn, falsch abgeknickt)
    g.strokeStyle = skin; g.lineWidth = 22;
    g.beginPath(); g.moveTo(-40, -560); g.lineTo(-70, -300); g.lineTo(-30, -20); g.lineTo(-80, 0); g.stroke();
    g.beginPath(); g.moveTo(40, -560); g.lineTo(90, -280); g.lineTo(40, -20); g.lineTo(95, 0); g.stroke();
    // Rumpf mit Rippen
    g.fillStyle = skin;
    g.beginPath(); g.moveTo(-70, -980); g.quadraticCurveTo(-95, -760, -50, -560); g.lineTo(50, -560); g.quadraticCurveTo(95, -760, 70, -980); g.closePath(); g.fill();
    g.strokeStyle = dark; g.lineWidth = 6;
    for (let i = 0; i < 7; i++) { const y = -920 + i * 42; g.beginPath(); g.moveTo(-60, y); g.quadraticCurveTo(0, y + 18, 60, y); g.stroke(); }
    // Arme: bis unter die Knie, lange Krallen
    g.strokeStyle = skin; g.lineWidth = 18;
    for (const sx of [-1, 1]) {
      g.beginPath(); g.moveTo(sx * 70, -970); g.lineTo(sx * 150, -650 + twitch * 20 * sx); g.lineTo(sx * 135, -280); g.stroke();
      g.lineWidth = 5;
      for (let f = -2; f <= 2; f++) { g.beginPath(); g.moveTo(sx * 135, -280); g.quadraticCurveTo(sx * (135 + f * 14), -200, sx * (130 + f * 22), -120 + Math.abs(f) * 15); g.stroke(); }
      g.lineWidth = 18;
    }
    // Hals + Kopf, schief gelegt
    g.lineWidth = 16; g.beginPath(); g.moveTo(0, -980); g.lineTo(Math.sin(tilt) * 60, -1060); g.stroke();
    g.save(); g.translate(Math.sin(tilt) * 60, -1150); g.rotate(tilt);
    g.fillStyle = skin; g.beginPath(); g.ellipse(0, 0, 70, 110, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000';
    for (const ex of [-28, 28]) { g.beginPath(); g.ellipse(ex, -20, 20, 28, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff';
    for (const ex of [-28, 28]) { g.beginPath(); g.arc(ex + twitch * 3, -16, 4, 0, Math.PI * 2); g.fill(); }
    // Grinsen bis zu den Ohren
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(-60, 40); g.quadraticCurveTo(0, 110, 60, 40); g.quadraticCurveTo(0, 70, -60, 40); g.fill();
    g.fillStyle = skin;
    for (let i = -5; i <= 5; i++) { g.beginPath(); g.moveTo(i * 10 - 4, 48 + (25 - i * i)); g.lineTo(i * 10, 62 + (25 - i * i)); g.lineTo(i * 10 + 4, 48 + (25 - i * i)); g.fill(); }
    g.restore();
    g.restore();
  }

  // Dunkle Szene: Nebel + ein Lichtkegel von oben, Figur darin
  function drawScene(c, size, tilt, light, twitch) {
    const W = c.width, H = c.height, g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (light <= 0) return;
    const cone = g.createRadialGradient(W / 2, H * 0.15, 10, W / 2, H * 0.7, H * 0.9);
    cone.addColorStop(0, `rgba(160,170,150,${0.35 * light})`); cone.addColorStop(0.5, `rgba(40,45,40,${0.25 * light})`); cone.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cone; g.fillRect(0, 0, W, H);
    // Boden
    g.fillStyle = `rgba(30,30,28,${light})`; g.fillRect(0, H * 0.62 + 380 * H / 1000 * 0.15, W, H);
    drawCreature(g, W, H, size, tilt, light, twitch);
    // Körnung
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    // Vignette
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.95)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  // Das Monstergesicht: sechs Augen, Kiefer reißt immer weiter auf, Zahnreihen, Risse
  function drawMonster(c, t) {
    const W = c.width, H = c.height, g = c.getContext('2d'), R = seeded(7);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const s = Math.min(W, H) / 1000, zoom = 0.9 + Math.min(1.4, t * 0.9);
    g.save(); g.translate(W / 2 + (Math.random() - 0.5) * 40 * s, H / 2 + (Math.random() - 0.5) * 40 * s); g.scale(s * zoom, s * zoom);
    // Schädel
    const skin = g.createRadialGradient(0, -120, 40, 0, 0, 560);
    skin.addColorStop(0, '#d8d6c4'); skin.addColorStop(0.5, '#8d8f78'); skin.addColorStop(1, '#151510');
    g.fillStyle = skin; g.beginPath(); g.ellipse(0, -40, 400, 520, 0, 0, Math.PI * 2); g.fill();
    // Adern und Risse
    g.strokeStyle = 'rgba(60,0,10,0.8)'; g.lineWidth = 4;
    for (let i = 0; i < 26; i++) {
      let x = (R() - 0.5) * 700, y = (R() - 0.5) * 900; g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (R() - 0.5) * 90; y += (R() - 0.5) * 90; g.lineTo(x, y); }
      g.stroke();
    }
    // Augen: zwei große + vier kleine, Pupillen zucken
    const eyes = [[-150, -170, 105], [150, -170, 105], [-60, -330, 45], [70, -360, 40], [-260, -20, 38], [255, -30, 42]];
    eyes.forEach(([x, y, r], i) => {
      const open = i < 2 ? 1 : Math.min(1, Math.max(0, (t - 0.3 - i * 0.12) * 3));
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, y, r * 1.25, r * 1.1, 0, 0, Math.PI * 2); g.fill();
      if (open <= 0) return;
      g.save(); g.beginPath(); g.ellipse(x, y, r, r * 0.85 * open, 0, 0, Math.PI * 2); g.clip();
      const w = g.createRadialGradient(x, y, 0, x, y, r); w.addColorStop(0, '#fff'); w.addColorStop(0.7, '#f0d0c0'); w.addColorStop(1, '#a01010');
      g.fillStyle = w; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      g.strokeStyle = 'rgba(200,0,0,0.7)'; g.lineWidth = 2;
      for (let k = 0; k < 8; k++) { const a = R() * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4); g.stroke(); }
      const px = x + (Math.random() - 0.5) * r * 0.3, py = y + (Math.random() - 0.5) * r * 0.3;
      g.fillStyle = '#b00000'; g.beginPath(); g.arc(px, py, r * 0.42, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.arc(px, py, r * 0.1, 0, Math.PI * 2); g.fill();
      g.restore();
    });
    // Blut aus den großen Augen
    g.fillStyle = '#5a0000';
    for (const x of [-150, 150]) { g.beginPath(); g.moveTo(x - 18, -90); g.quadraticCurveTo(x - 6, 40, x - 12, 120 + t * 80); g.lineTo(x + 8, 120 + t * 80); g.quadraticCurveTo(x + 6, 20, x + 18, -90); g.fill(); }
    // Kiefer reißt auf (bis über den Kopf hinaus)
    const jaw = Math.min(1, 0.35 + t * 0.6), mw = 300, mh = 140 + 330 * jaw, my = 150 + 90 * jaw;
    g.fillStyle = '#0a0000'; g.beginPath(); g.ellipse(0, my, mw, mh, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a0004'; g.beginPath(); g.ellipse(0, my + mh * 0.35, mw * 0.55, mh * 0.35, 0, 0, Math.PI * 2); g.fill();
    // zwei Zahnreihen oben und unten, schief und spitz
    for (const row of [0, 1]) {
      const sc = row ? 0.72 : 1, col = row ? '#a89c70' : '#ece4c4';
      g.fillStyle = col;
      for (let i = -9; i <= 9; i++) {
        const x = i * 31 * sc, e = Math.sqrt(Math.max(0, 1 - (x / mw) ** 2)), top = my - mh * e * sc, bot = my + mh * e * sc, len = 70 + ((i * 37) % 40);
        g.beginPath(); g.moveTo(x - 13, top); g.lineTo(x + (i % 3) * 4, top + len * sc); g.lineTo(x + 13, top); g.fill();
        g.beginPath(); g.moveTo(x - 13, bot); g.lineTo(x - (i % 3) * 4, bot - len * 0.9 * sc); g.lineTo(x + 13, bot); g.fill();
      }
    }
    // Sabber
    g.strokeStyle = 'rgba(200,190,170,0.5)'; g.lineWidth = 3;
    for (const x of [-120, -30, 80, 160]) { g.beginPath(); g.moveTo(x, my - mh * 0.8); g.quadraticCurveTo(x + 5, my, x - 4, my + mh * 0.75); g.stroke(); }
    g.restore();
  }

  function audio3(steps, quietAt, hitAt, hitDur) {
    const S = window.Sound;
    let ctx = S && S.ctx;
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -3; comp.ratio.value = 14; comp.connect(ctx.destination);
    const out = ctx.createGain(); out.connect(comp);
    out.gain.setValueAtTime(1, t0); out.gain.setValueAtTime(1, t0 + quietAt - 0.05); out.gain.linearRampToValueAtTime(0, t0 + quietAt);
    out.gain.setValueAtTime(0, t0 + hitAt - 0.01); out.gain.linearRampToValueAtTime(1, t0 + hitAt);
    out.gain.setValueAtTime(1, t0 + hitAt + hitDur - 0.6); out.gain.linearRampToValueAtTime(0, t0 + hitAt + hitDur);
    const noise = (len) => { const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
    // Atmen: Rauschen, langsam an/ab, wird schneller und lauter
    const br = ctx.createBufferSource(); br.buffer = noise(quietAt);
    const bbp = ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 700; bbp.Q.value = 1.4;
    const bg = ctx.createGain(); bg.gain.value = 0.05;
    const blfo = ctx.createOscillator(), blg = ctx.createGain();
    blfo.frequency.setValueAtTime(0.35, t0); blfo.frequency.linearRampToValueAtTime(1.6, t0 + quietAt);
    blg.gain.setValueAtTime(0.05, t0); blg.gain.linearRampToValueAtTime(0.35, t0 + quietAt);
    blfo.connect(blg); blg.connect(bg.gain); br.connect(bbp); bbp.connect(bg); bg.connect(out);
    br.start(t0); blfo.start(t0); blfo.stop(t0 + quietAt);
    // Dröhnen
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const dg = ctx.createGain(); dg.gain.setValueAtTime(0.05, t0); dg.gain.linearRampToValueAtTime(0.3, t0 + quietAt);
    lp.connect(dg); dg.connect(out);
    for (const f of [36.7, 38.9, 55]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t0); o.stop(t0 + quietAt); }
    // Bei jedem Licht-Aus: Knacken, Licht-An: Knurren (immer lauter)
    steps.forEach((st, i) => {
      const off = t0 + st.at, on = off + st.dark;
      const cr = ctx.createBufferSource(); cr.buffer = noise(0.08);
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.5, off); cg.gain.exponentialRampToValueAtTime(0.001, off + 0.08);
      cr.connect(cg); cg.connect(out); cr.start(off);
      const gr = ctx.createOscillator(), am = ctx.createOscillator(), amg = ctx.createGain(), glp = ctx.createBiquadFilter(), gg = ctx.createGain();
      gr.type = 'sawtooth'; gr.frequency.setValueAtTime(65 + i * 6, on); gr.frequency.linearRampToValueAtTime(48, on + 0.7);
      am.frequency.value = 28; amg.gain.value = 0.5; am.connect(amg); amg.connect(gg.gain);
      glp.type = 'lowpass'; glp.frequency.value = 500 + i * 150;
      gg.gain.setValueAtTime(0, on); gg.gain.linearRampToValueAtTime(0.15 + i * 0.12, on + 0.08); gg.gain.linearRampToValueAtTime(0, on + 0.8);
      gr.connect(glp); glp.connect(gg); gg.connect(out); gr.start(on); am.start(on); gr.stop(on + 0.85); am.stop(on + 0.85);
    });
    // Der Schlag: Horror-Schrei + kreischender Sweep + Sub-Brüllen
    const th = t0 + hitAt;
    scream2(ctx, out, th, hitDur);
    const sw = ctx.createOscillator(), swg = ctx.createGain(); sw.type = 'square';
    sw.frequency.setValueAtTime(220, th); sw.frequency.exponentialRampToValueAtTime(3400, th + 0.5); sw.frequency.exponentialRampToValueAtTime(1800, th + hitDur);
    swg.gain.value = 0.12; sw.connect(swg); swg.connect(out); sw.start(th); sw.stop(th + hitDur);
    const sub = ctx.createOscillator(), subg = ctx.createGain(), subam = ctx.createOscillator(), subamg = ctx.createGain();
    sub.type = 'sawtooth'; sub.frequency.setValueAtTime(55, th); sub.frequency.linearRampToValueAtTime(38, th + hitDur);
    subam.frequency.value = 22; subamg.gain.value = 0.4; subam.connect(subamg); subamg.connect(subg.gain);
    subg.gain.value = 0.6; sub.connect(subg); subg.connect(out); sub.start(th); subam.start(th); sub.stop(th + hitDur); subam.stop(th + hitDur);
    const total = hitAt + hitDur;
    if (S && S.setDuck) { S.setDuck(0); setTimeout(() => S.setDuck(1), total * 1000); }
  }

  let busy3 = false;
  function play3() {
    if (busy3 || busy2 || busy) return; busy3 = true;
    // Ablauf (Sekunden): Fake-Verbindungsfehler, dann Dunkelheit mit Figur, die bei jedem Flackern näher kommt
    const FAKE = 1.6;
    const steps = [], sizes = [0.14, 0.22, 0.34, 0.5, 0.72, 1.0], tilts = [0, 0.15, -0.25, 0.5, -0.8, 1.3];
    let at = FAKE + 1.4;
    for (let i = 0; i < sizes.length; i++) { const dark = 0.25 + Math.random() * 0.35; steps.push({ at, dark, size: sizes[i], tilt: tilts[i] }); at += dark + Math.max(0.55, 1.4 - i * 0.18); }
    const QUIET = at, GAP = 1.1, HIT = 4.2, hitAt = QUIET + GAP, total = (hitAt + HIT) * 1000;
    const host = document.fullscreenElement || document.body;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:all;overflow:hidden;background:transparent';
    const c = document.createElement('canvas');
    c.width = innerWidth; c.height = innerHeight;
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0';
    const box = document.createElement('div');
    box.textContent = 'Verbindung zum Server unterbrochen …';
    box.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(20,20,24,.92);color:#ddd;padding:18px 26px;border-radius:12px;font:600 16px system-ui,-apple-system,Arial,sans-serif;box-shadow:0 8px 30px #000a;white-space:nowrap';
    const msg = document.createElement('div');
    msg.style.cssText = 'position:absolute;left:0;right:0;bottom:12vh;text-align:center;color:#ddd;font:italic 400 clamp(14px,2.4vw,28px) Georgia,serif;opacity:0;letter-spacing:.3em';
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;mix-blend-mode:difference;opacity:0';
    const red = document.createElement('div');
    red.style.cssText = 'position:absolute;inset:0;background:#f00;mix-blend-mode:multiply;opacity:0';
    wrap.append(c, red, box, msg, flash); host.appendChild(wrap);
    try { audio3(steps, QUIET, hitAt, HIT); } catch (e) { /* kein Ton */ }
    const start = performance.now();
    let vibed = false;
    (function frame(now) {
      const t = (now - start) / 1000;
      if (t < FAKE) {
        // harmlos aussehender Fehler, Spiel dahinter wird dunkel
        wrap.style.background = `rgba(0,0,0,${Math.min(0.6, t * 0.5)})`;
        box.style.opacity = 1;
      } else if (t < QUIET) {
        box.style.opacity = 0; wrap.style.background = '#000'; c.style.opacity = 1;
        // aktueller Schritt: Figur steht still; in den Dunkelphasen ist sie weg und rückt näher
        let cur = null, dark = t < FAKE + 1.4;
        for (const st of steps) { if (t >= st.at) cur = st; }
        if (cur && t < cur.at + cur.dark) dark = true;
        const flick = Math.random() < 0.06 ? 0.3 : 1;
        if (dark || !cur) drawScene(c, 0, 0, 0, 0);
        else drawScene(c, cur.size, cur.tilt, flick * (0.55 + cur.size * 0.45), Math.random() < 0.08 ? (Math.random() - 0.5) * 6 : 0);
        const k = (t - FAKE) / (QUIET - FAKE);
        msg.textContent = k < 0.5 ? 'es hat dich gefunden' : 'es ist gleich da';
        msg.style.opacity = dark ? 0 : 0.35 + k * 0.4;
      } else if (t < hitAt) {
        // Stille, komplett schwarz, nur ein Flüstern-Text
        drawScene(c, 0, 0, 0, 0); msg.textContent = 'hinter dir';
        msg.style.opacity = t > QUIET + GAP * 0.4 ? 0.7 : 0;
      } else {
        const h = t - hitAt, k = Math.max(0, 1 - h / HIT);
        if (!vibed) { vibed = true; if (navigator.vibrate) try { navigator.vibrate([900, 50, 900, 50, 1200, 50, 1200]); } catch (e) { /* */ } }
        msg.style.opacity = 0;
        drawMonster(c, h);
        glitch(c, 0.6 + k * 1.2);
        const sh = 90 * k;
        c.style.transform = `translate(${(Math.random() - 0.5) * sh}px,${(Math.random() - 0.5) * sh}px) rotate(${(Math.random() - 0.5) * 10 * k}deg) scale(${1 + Math.random() * 0.2})`;
        red.style.opacity = Math.random() < 0.4 ? 0.9 : 0;
        flash.style.opacity = h < 0.12 || Math.random() < 0.16 ? 1 : 0;
        wrap.style.filter = Math.random() < 0.2 ? 'invert(1) hue-rotate(180deg) contrast(2)' : (Math.random() < 0.15 ? 'contrast(3) saturate(4)' : '');
      }
      if (now - start < total) requestAnimationFrame(frame);
      else { wrap.remove(); busy3 = false; }
    })(start);
  }

  // ---------- Jumpscare 4 "KOFFERRAUM": Es klopft im Kofferraum, Deckel geht einen Spalt auf, dann springt es raus (~11 s) ----------

  // Nacht-Parkplatz, BMW von hinten. open 0..1 = Kofferraumdeckel, rock = Wackeln, eyes 0..1, lamp 0..1
  function drawTrunkScene(c, open, rock, eyes, fingers, lamp) {
    const W = c.width, H = c.height, g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const gy = H * 0.8;
    // Straßenlaterne von oben links
    const cone = g.createRadialGradient(W * 0.3, -H * 0.1, 10, W * 0.45, gy, H * 1.1);
    cone.addColorStop(0, `rgba(255,190,110,${0.5 * lamp})`); cone.addColorStop(0.45, `rgba(90,70,50,${0.25 * lamp})`); cone.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cone; g.fillRect(0, 0, W, H);
    // nasser Asphalt
    const road = g.createLinearGradient(0, gy - 40, 0, H);
    road.addColorStop(0, `rgba(30,28,26,${0.6 + 0.4 * lamp})`); road.addColorStop(1, '#050505');
    g.fillStyle = road; g.fillRect(0, gy - 40, W, H);

    const s = Math.min(W / 1300, H / 950);
    g.save(); g.translate(W / 2, gy); g.scale(s, s); g.rotate(rock * 0.012); g.translate(0, -Math.abs(rock) * 6);
    const L = 0.35 + 0.65 * lamp, col = (r, gg, b) => `rgb(${r * L | 0},${gg * L | 0},${b * L | 0})`;
    // Schatten
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.beginPath(); g.ellipse(0, 0, 520, 40, 0, 0, Math.PI * 2); g.fill();
    // Reifen
    g.fillStyle = '#0a0a0a';
    for (const x of [-330, 330]) { g.beginPath(); g.roundRect(x - 60, -110, 120, 110, 18); g.fill(); }
    // Dach + Heckscheibe
    g.fillStyle = col(38, 40, 46); g.beginPath(); g.moveTo(-230, -580); g.lineTo(230, -580); g.lineTo(255, -545); g.lineTo(-255, -545); g.closePath(); g.fill();
    const glass = g.createLinearGradient(0, -545, 0, -370);
    glass.addColorStop(0, col(30, 38, 52)); glass.addColorStop(1, col(8, 10, 14));
    g.fillStyle = glass; g.beginPath(); g.moveTo(-255, -545); g.lineTo(255, -545); g.lineTo(380, -370); g.lineTo(-380, -370); g.closePath(); g.fill();
    g.strokeStyle = `rgba(255,220,180,${0.12 * lamp})`; g.lineWidth = 10;
    g.beginPath(); g.moveTo(-180, -530); g.lineTo(-300, -390); g.stroke();
    // Karosserie hinten (Kotflügel + Stoßstange)
    const body = g.createLinearGradient(0, -380, 0, -80);
    body.addColorStop(0, col(70, 72, 80)); body.addColorStop(1, col(22, 23, 27));
    g.fillStyle = body; g.beginPath(); g.moveTo(-395, -375); g.lineTo(395, -375); g.lineTo(450, -300); g.lineTo(455, -110); g.quadraticCurveTo(455, -80, 420, -80);
    g.lineTo(-420, -80); g.quadraticCurveTo(-455, -80, -455, -110); g.lineTo(-450, -300); g.closePath(); g.fill();
    g.fillStyle = col(16, 16, 19); g.fillRect(-440, -170, 880, 16);
    // Auspuff
    g.fillStyle = '#050505'; for (const x of [250, 310]) { g.beginPath(); g.ellipse(x, -88, 24, 12, 0, 0, Math.PI * 2); g.fill(); }
    // Kofferraum-Öffnung (Innenraum schwarz, leicht rot)
    const lidBottom = -255 - open * 290, gapTop = Math.min(lidBottom, -255);
    if (open > 0.001) {
      const inside = g.createLinearGradient(0, gapTop, 0, -255);
      inside.addColorStop(0, '#000'); inside.addColorStop(1, `rgba(40,0,0,1)`);
      g.fillStyle = inside; g.beginPath(); g.moveTo(-300, -375); g.lineTo(300, -375); g.lineTo(305, -255); g.lineTo(-305, -255); g.closePath(); g.fill();
      if (open < 0.999) { g.fillStyle = '#000'; g.fillRect(-305, gapTop, 610, -255 - gapTop); }
      // Augen im Spalt
      if (eyes > 0) {
        const ey = (lidBottom + -255) / 2 + 4;
        for (const ex of [-55, 55]) {
          const e = g.createRadialGradient(ex, ey, 0, ex, ey, 34);
          e.addColorStop(0, `rgba(255,255,255,${eyes})`); e.addColorStop(0.25, `rgba(255,20,20,${eyes})`); e.addColorStop(1, 'rgba(255,0,0,0)');
          g.fillStyle = e; g.beginPath(); g.arc(ex, ey, 34, 0, Math.PI * 2); g.fill();
        }
      }
    }
    // Kofferraumdeckel (klappt nach oben weg, wird dabei flacher)
    const lidH = 120 * (1 - open * 0.75);
    g.fillStyle = col(64, 66, 74); g.beginPath();
    g.moveTo(-305, lidBottom); g.lineTo(305, lidBottom); g.lineTo(300 - open * 30, lidBottom - lidH); g.lineTo(-300 + open * 30, lidBottom - lidH); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.stroke();
    // Rücklichter (L-Form) mit Glühen
    for (const sx of [-1, 1]) {
      g.save(); g.scale(sx, 1);
      const glow = g.createRadialGradient(380, -310, 5, 380, -310, 180);
      glow.addColorStop(0, 'rgba(255,30,20,0.55)'); glow.addColorStop(1, 'rgba(255,0,0,0)');
      g.fillStyle = glow; g.fillRect(200, -490, 360, 360);
      g.fillStyle = '#c3120c'; g.beginPath(); g.moveTo(312, -365); g.lineTo(392, -365); g.lineTo(442, -300); g.lineTo(442, -250); g.lineTo(312, -250); g.closePath(); g.fill();
      g.fillStyle = '#ff6a55'; g.fillRect(330, -345, 80, 18);
      g.restore();
    }
    // Kennzeichen
    g.fillStyle = col(225, 225, 215); g.fillRect(-120, -235, 240, 56);
    g.fillStyle = '#1b3fb0'; g.fillRect(-120, -235, 26, 56);
    g.fillStyle = '#111'; g.font = '900 38px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M\u00b7E 46', 14, -206);
    // Finger, die sich unter dem Deckel herauskrallen
    if (fingers > 0 && open > 0.01) {
      g.strokeStyle = `rgba(215,205,190,${fingers})`; g.lineCap = 'round'; g.lineWidth = 12;
      for (let i = 0; i < 4; i++) {
        const x = -200 + i * 30;
        g.beginPath(); g.moveTo(x, lidBottom + 4); g.quadraticCurveTo(x - 6, lidBottom + 26 * fingers, x + 4, lidBottom + 40 * fingers); g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const x = 110 + i * 30;
        g.beginPath(); g.moveTo(x, lidBottom + 4); g.quadraticCurveTo(x + 6, lidBottom + 22 * fingers, x - 2, lidBottom + 34 * fingers); g.stroke();
      }
    }
    g.restore();
    // Körnung + Vignette
    for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    return { x: W / 2, y: gy + (-255 - open * 145) * s, s };
  }

  // Die Gestalt im Sprung: fliegt aus dem Kofferraum direkt auf die Kamera zu (k 0..1)
  function drawLeaper(c, from, k) {
    const W = c.width, H = c.height, g = c.getContext('2d');
    const e = k * k * k, size = from.s * (0.35 + e * 9);
    const x = from.x + (W / 2 - from.x) * e, y = from.y + (H * 0.45 - from.y) * e - Math.sin(k * Math.PI) * H * 0.15;
    g.save(); g.translate(x, y); g.scale(size, size); g.rotate(Math.sin(k * 9) * 0.15);
    g.lineCap = 'round'; g.strokeStyle = '#cfc6b6'; g.lineWidth = 22;
    // Arme nach vorne ausgestreckt, Krallen
    for (const sx of [-1, 1]) {
      g.beginPath(); g.moveTo(sx * 60, 120); g.lineTo(sx * 230, 30); g.lineTo(sx * 320, -60); g.stroke();
      g.lineWidth = 7;
      for (let f = -2; f <= 2; f++) { g.beginPath(); g.moveTo(sx * 320, -60); g.lineTo(sx * (360 + Math.abs(f) * 6), -60 + f * 26); g.stroke(); }
      g.lineWidth = 22;
    }
    g.fillStyle = '#b9b0a0'; g.beginPath(); g.ellipse(0, 230, 90, 160, 0, 0, Math.PI * 2); g.fill();
    // Kopf mit aufgerissenem Maul
    g.fillStyle = '#ddd5c6'; g.beginPath(); g.ellipse(0, 0, 120, 160, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000';
    for (const ex of [-45, 45]) { g.beginPath(); g.ellipse(ex, -40, 32, 42, ex < 0 ? 0.3 : -0.3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ff2020';
    for (const ex of [-45, 45]) { g.beginPath(); g.arc(ex, -36, 9, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, 75, 60, 40 + k * 45, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#eee';
    for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(i * 13 - 5, 40); g.lineTo(i * 13, 62); g.lineTo(i * 13 + 5, 40); g.fill(); }
    g.restore();
  }

  function audio4(knocks, creakAt, quietAt, hitAt, hitDur) {
    const S = window.Sound;
    let ctx = S && S.ctx;
    try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -3; comp.ratio.value = 14; comp.connect(ctx.destination);
    const out = ctx.createGain(); out.connect(comp);
    out.gain.setValueAtTime(1, t0); out.gain.setValueAtTime(1, t0 + quietAt - 0.05); out.gain.linearRampToValueAtTime(0, t0 + quietAt);
    out.gain.setValueAtTime(0, t0 + hitAt - 0.01); out.gain.linearRampToValueAtTime(1, t0 + hitAt);
    out.gain.setValueAtTime(1, t0 + hitAt + hitDur - 0.6); out.gain.linearRampToValueAtTime(0, t0 + hitAt + hitDur);
    const noise = (len) => { const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
    // Wind / Nacht
    const wind = ctx.createBufferSource(); wind.buffer = noise(quietAt);
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 400;
    const wg = ctx.createGain(); wg.gain.value = 0.08;
    wind.connect(wlp); wlp.connect(wg); wg.connect(out); wind.start(t0);
    // Dumpfes Klopfen von innen gegen Blech (wird lauter)
    knocks.forEach((at, i) => {
      const t = t0 + at, vol = 0.25 + (i / knocks.length) * 0.75;
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
      og.gain.setValueAtTime(vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.3);
      const n = ctx.createBufferSource(); n.buffer = noise(0.06);
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 2;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      n.connect(nf); nf.connect(ng); ng.connect(out); n.start(t);
    });
    // Knarzendes Scharnier
    const tc = t0 + creakAt, cd = 1.4;
    const cr = ctx.createOscillator(), crf = ctx.createBiquadFilter(), crg = ctx.createGain(), crl = ctx.createOscillator(), crlg = ctx.createGain();
    cr.type = 'sawtooth'; cr.frequency.setValueAtTime(70, tc); cr.frequency.linearRampToValueAtTime(110, tc + cd);
    crl.type = 'square'; crl.frequency.value = 17; crlg.gain.value = 0.12; crl.connect(crlg); crlg.connect(crg.gain);
    crf.type = 'bandpass'; crf.frequency.value = 1300; crf.Q.value = 6;
    crg.gain.setValueAtTime(0, tc); crg.gain.linearRampToValueAtTime(0.15, tc + 0.2); crg.gain.setValueAtTime(0.15, tc + cd - 0.2); crg.gain.linearRampToValueAtTime(0, tc + cd);
    cr.connect(crf); crf.connect(crg); crg.connect(out); cr.start(tc); crl.start(tc); cr.stop(tc + cd); crl.stop(tc + cd);
    // Knurren aus dem Spalt
    const gr = ctx.createOscillator(), am = ctx.createOscillator(), amg = ctx.createGain(), glp = ctx.createBiquadFilter(), gg = ctx.createGain();
    gr.type = 'sawtooth'; gr.frequency.setValueAtTime(58, tc + 0.6); gr.frequency.linearRampToValueAtTime(44, t0 + quietAt);
    am.frequency.value = 26; amg.gain.value = 0.4; am.connect(amg); amg.connect(gg.gain);
    glp.type = 'lowpass'; glp.frequency.value = 600;
    gg.gain.setValueAtTime(0, tc + 0.6); gg.gain.linearRampToValueAtTime(0.4, t0 + quietAt - 0.1);
    gr.connect(glp); glp.connect(gg); gg.connect(out); gr.start(tc + 0.6); am.start(tc + 0.6); gr.stop(t0 + quietAt); am.stop(t0 + quietAt);
    // Der Sprung: Deckel knallt auf + Schrei
    const th = t0 + hitAt;
    const bang = ctx.createBufferSource(); bang.buffer = noise(0.5);
    const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 2500;
    const bg = ctx.createGain(); bg.gain.setValueAtTime(1, th); bg.gain.exponentialRampToValueAtTime(0.001, th + 0.5);
    bang.connect(blp); blp.connect(bg); bg.connect(out); bang.start(th);
    scream2(ctx, out, th, hitDur);
    const sub = ctx.createOscillator(), subg = ctx.createGain();
    sub.type = 'sawtooth'; sub.frequency.setValueAtTime(60, th); sub.frequency.linearRampToValueAtTime(35, th + hitDur);
    subg.gain.value = 0.5; sub.connect(subg); subg.connect(out); sub.start(th); sub.stop(th + hitDur);
    if (S && S.setDuck) { S.setDuck(0); setTimeout(() => S.setDuck(1), (hitAt + hitDur) * 1000); }
  }

  let busy4 = false;
  function play4() {
    if (busy4 || busy3 || busy2 || busy) return; busy4 = true;
    // Ablauf (Sekunden)
    const FADE = 1.0, knocks = [], CREAK = 6.2, QUIET = 8.3, HIT_AT = 9.2, LEAP = 0.38, HIT = 3.2;
    let at = 1.8;
    for (let i = 0; i < 11; i++) { knocks.push(at); at += i < 3 ? 0.9 : i < 6 ? 0.45 : 0.2 + Math.random() * 0.1; }
    const total = (HIT_AT + HIT) * 1000;
    const host = document.fullscreenElement || document.body;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:all;overflow:hidden;background:transparent';
    const c = document.createElement('canvas');
    c.width = innerWidth; c.height = innerHeight;
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0';
    const msg = document.createElement('div');
    msg.style.cssText = 'position:absolute;left:0;right:0;bottom:8vh;text-align:center;color:#ddd;font:italic 400 clamp(14px,2.4vw,28px) Georgia,serif;opacity:0;letter-spacing:.3em';
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;mix-blend-mode:difference;opacity:0';
    const red = document.createElement('div');
    red.style.cssText = 'position:absolute;inset:0;background:#f00;mix-blend-mode:multiply;opacity:0';
    wrap.append(c, red, msg, flash); host.appendChild(wrap);
    try { audio4(knocks, CREAK, QUIET, HIT_AT, HIT); } catch (e) { /* kein Ton */ }
    const start = performance.now();
    let vibed = false, from = null;
    (function frame(now) {
      const t = (now - start) / 1000;
      // Wackeln: kurz nach jedem Klopfer
      let rock = 0;
      for (const k of knocks) { const d = t - k; if (d >= 0 && d < 0.25) rock = (1 - d / 0.25) * (Math.random() < 0.5 ? -1 : 1); }
      const lamp = Math.random() < (t > CREAK ? 0.12 : 0.03) ? 0.2 : 1;
      if (t < HIT_AT) {
        c.style.opacity = Math.min(1, t / FADE);
        let open = 0, eyes = 0, fingers = 0;
        if (t > CREAK) { const k = Math.min(1, (t - CREAK) / 1.4); open = 0.13 * (k * k * (3 - 2 * k)); eyes = Math.max(0, Math.min(1, (t - CREAK - 0.8) / 0.6)); }
        if (t > CREAK + 1.2) fingers = Math.min(1, (t - CREAK - 1.2) / 0.5);
        if (t >= QUIET) { msg.style.opacity = 0; }
        if (t >= QUIET && t < HIT_AT) { drawTrunkScene(c, open, 0, eyes * (Math.random() < 0.1 ? 0 : 1), fingers, 0.25); }
        else from = drawTrunkScene(c, open, rock, eyes, fingers, lamp);
        msg.textContent = t < CREAK ? 'was war das?' : 'es will raus';
        if (t < QUIET) msg.style.opacity = t > 2.5 ? 0.6 : 0;
        c.style.transform = rock ? `translate(${rock * 4}px,${Math.abs(rock) * 3}px)` : '';
      } else {
        const h = t - HIT_AT, k = Math.max(0, 1 - h / HIT);
        if (!vibed) { vibed = true; if (navigator.vibrate) try { navigator.vibrate([800, 50, 900, 50, 1200]); } catch (e) { /* */ } }
        msg.style.opacity = 0;
        if (h < LEAP) {
          const pos = drawTrunkScene(c, 1, (Math.random() - 0.5) * 2, 0, 0, 1);
          drawLeaper(c, from || pos, h / LEAP);
        } else {
          drawMonster(c, h - LEAP);
          glitch(c, 0.6 + k * 1.2);
        }
        const sh = 90 * k;
        c.style.transform = `translate(${(Math.random() - 0.5) * sh}px,${(Math.random() - 0.5) * sh}px) rotate(${(Math.random() - 0.5) * 8 * k}deg) scale(${1 + Math.random() * 0.15})`;
        red.style.opacity = h > LEAP && Math.random() < 0.35 ? 0.9 : 0;
        flash.style.opacity = h < 0.08 || (h > LEAP && Math.random() < 0.15) ? 1 : 0;
        wrap.style.filter = h > LEAP && Math.random() < 0.2 ? 'invert(1) hue-rotate(180deg) contrast(2)' : '';
      }
      if (now - start < total) requestAnimationFrame(frame);
      else { wrap.remove(); busy4 = false; }
    })(start);
  }

  // Schwarzbild vom Admin: Vollbild schwarz mit weißem Text (~4 s)
  let textBusy = false;
  function text(msg, dur = 4000) {
    if (textBusy) return; textBusy = true;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;pointer-events:all;display:flex;align-items:center;justify-content:center;padding:5vw;box-sizing:border-box';
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'color:#fff;font:900 clamp(40px,11vw,200px)/1.05 system-ui,-apple-system,Arial,sans-serif;text-align:center;letter-spacing:.02em';
    wrap.appendChild(t);
    (document.fullscreenElement || document.body).appendChild(wrap);
    setTimeout(() => { wrap.remove(); textBusy = false; }, dur);
  }

  window.Jumpscare = { play, play2, play3, play4, text };
})();
