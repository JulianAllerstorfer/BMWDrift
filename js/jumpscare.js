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

  window.Jumpscare = { play };
})();
