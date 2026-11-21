/* =====================================================================
   E46 DRIFT – Hauptprogramm (Garage, Fahren, Punkte, Kamera, HUD)
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / 120;

  // ---------- Einstellungen ----------
  const TUNE_DEF = { power: 100, turbo: 0, finalPct: 100, weightPct: 100, brakePower: 100, brakeBias: 64, steerSpeed: 100, lock: 54, hbrake: 100, roll: 100, tires: 0, soot: 60, backfire: 100, pressF: 2.2, pressR: 2.2, lsd: 80, stabi: 55 };
  const DEF = Object.assign({ tod: 'auto', fx: true, engines: {}, map: 'hakone', fuelOn: true, model: 'e46', rimSize: 1, letters: false, lipColor: 0, paint: 0, rimStyle: 0, rimColor: 0, drop: 6, camber: 5, track: 3, assist: 70, maxang: 58, auto: true, sound: true, volume: 100, smokeOn: true }, TUNE_DEF, E46.LOOK_DEF);
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  const cfg = Object.assign({}, DEF, load('e46drift.cfg', {}));
  const rec = Object.assign({ best: 0, bestTotal: 0 }, load('e46drift.rec', {}));
  Prog.clampCfg(cfg); cfg.lvl = Prog.level();          // Tuning nur so weit, wie es gekauft ist
  let cfgSendT = null;
  const save = () => {
    store('e46drift.cfg', cfg);
    if (window.Net && Net.connected) { clearTimeout(cfgSendT); cfgSendT = setTimeout(() => Net.sendCfg(cfg), 250); }
  };
  let myName = load('e46drift.name', '') || ('Drifter' + (Math.random() * 90 + 10 | 0));

  let peds = null;
  let renderer, camera, driveScene, garageScene, track, car, phys, smoke, skids, flames, sparks, post, headSpot;
  let mode = 'loading';
  let garageTurn = 0.6, dragging = false, dragX = 0, dragVel = 0;

  const SHOT = location.hash.indexOf('shot') >= 0;
  if (!SHOT) setTimeout(init, 30);

  function init() {
    // Kantenglättung macht die Nachbearbeitung (Post) selbst; nur ohne WebGL 2 übernimmt sie der Bildschirm-Puffer
    const gl2 = !!document.createElement('canvas').getContext('webgl2');
    renderer = new T.WebGLRenderer({ antialias: !gl2, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    $('app').appendChild(renderer.domElement);
    camera = new T.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
    post = Post.create(renderer); post.enabled = cfg.fx !== false;

    driveScene = new T.Scene();
    if (!Track.MAPS[cfg.map]) cfg.map = 'hakone';
    track = Track.build(driveScene, renderer, cfg.map);
    peds = makePeds();
    Net.myMap = cfg.map;
    garageScene = buildGarage();

    if (!window.CAR_MODELS[cfg.model]) cfg.model = 'e46';
    smoke = new FX.Smoke(driveScene, 1400);
    skids = new FX.Skids(driveScene, 7000);
    sparks = new FX.Sparks(driveScene, 260);
    // Abblendlicht des eigenen Autos (leuchtet nur bei Dunkelheit)
    headSpot = new T.SpotLight(0xfff0d2, 0, 75, 0.5, 0.75, 1.2);
    driveScene.add(headSpot, headSpot.target);
    buildCar();
    // Alle Modelle einmal vorab aufbauen (noch hinter dem Ladebildschirm): die Karosserie-Berechnung wird dabei
    // gemerkt, damit fremde Autos (Beitritt, Autowechsel) und der eigene Wechsel in der Garage später nicht ruckeln
    for (const id of Object.keys(window.CAR_MODELS)) {
      if (id === cfg.model) continue;
      try { E46.create({ model: id }).dispose(); } catch (e) { /* nur Vorwärmen */ }
    }
    phys = new Physics.Car();
    Physics.applyTuning(cfg);
    Net.init({ scene: driveScene, smoke, skids, me: () => phys, soundOn: () => !!cfg.sound, volume: () => Math.min(1, cfg.volume / 100) });
    Net.onChange = refreshMP;
    Net.onEvent = (txt) => { if (mode === 'drive') popup(txt, '', false); chatAdd({ kind: 'sys', text: txt }); refreshMP(); };
    Net.onChat = chatAdd;
    Net.onFlip = flipStart;
    // Rekorde gelten nur so, wie der Server sie geprüft hat – im Browser geänderte Werte werden überschrieben
    Net.onRec = (r, reset) => {
      rec.best = Math.max(0, +r.best || 0);
      if (r.bestCar) rec.bestModel = r.bestCar; else delete rec.bestModel;
      cfg.bestCar = r.bestCar || null;
      const sc = r.chal || {}; rec.chal = rec.chal || {};
      for (const k of Object.keys(rec.chal)) if (!sc[k]) delete rec.chal[k];
      for (const k in sc) { const o = rec.chal[k]; rec.chal[k] = { pts: sc[k].pts, time: o ? o.time : 0, model: sc[k].car || (o && o.model) || cfg.model }; }
      cfg.chalRec = {}; cfg.chalRecCar = {};
      for (const k in sc) { cfg.chalRec[k] = sc[k].pts; if (sc[k].car) cfg.chalRecCar[k] = sc[k].car; }
      Net.myBest = rec.best; Net.myBestCar = rec.bestModel || null;
      store('e46drift.rec', rec); save();
      $('best').textContent = fmt(rec.best); $('bestCar').textContent = rec.best && rec.bestModel ? carName(rec.bestModel) : '';
      if (reset) chatAdd({ kind: 'sys', text: 'Deine Rekorde wurden vom Host zurückgesetzt.' });
      refreshMP();
    };
    $('chatInput').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
    });
    $('chatInput').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('chatInput')) $('chat').classList.remove('open'); }, 0));
    // Rekord-Auto: geratene Einträge (früher nachgetragen, ohne cfg.bestCar) wieder entfernen – echte Rekorde setzen beides
    if (rec.bestModel && !cfg.bestCar) { delete rec.bestModel; store('e46drift.rec', rec); }
    // Korrektur per Link: …/#rekordauto=zipfer trägt das Auto des besten Drifts ein
    {
      const m = location.hash.match(/rekordauto=(\w+)/);
      if (m && window.CAR_MODELS[m[1]] && rec.best > 0) {
        rec.bestModel = m[1]; cfg.bestCar = m[1]; store('e46drift.rec', rec); save();
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(() => popup('REKORD-AUTO', window.CAR_MODELS[m[1]].name, false), 800);
      }
    }
    Net.myBest = rec.best; Net.myBestCar = rec.bestModel || null;
    if (Net.available) Net.connect(myName, cfg);

    buildUI();
    applySmoke();
    window.addEventListener('resize', onResize);
    onResize();
    enterGarage();
    $('loading').classList.add('hidden');
    if (SHOT) { shotScenario(); return; }
    requestAnimationFrame(frame);
  }

  // Auto (neu) aufbauen – beim Start und beim Fahrzeugwechsel
  function buildCar() {
    let parent = null;
    if (car) { parent = car.root.parent; if (parent) parent.remove(car.root); car.dispose(); fuel = 1; }   // Fahrzeugwechsel: voller Tank
    const eng = Physics.engineOf(cfg);
    car = E46.create({
      badge: eng.badge, diesel: !!eng.diesel,
      model: cfg.model, rimSize: cfg.rimSize, letters: cfg.letters, plate: cfg.plate, paint: E46.PAINTS[cfg.paint].hex, rimStyle: cfg.rimStyle, rimColor: E46.RIM_COLORS[cfg.rimColor].hex,
      drop: cfg.drop / 100, camber: cfg.camber, track: cfg.track / 100
    });
    car.setLook(E46.lookFromCfg(cfg));
    car.setWheelOpts({ lip: (E46.LIP_COLORS[cfg.lipColor] || E46.LIP_COLORS[0]).hex });
    markShadows();
    flames = new FX.Flames(car.chassis);
    flames.setAt(car.exhaust);
    Sound.setEngine && Sound.setEngine(eng.key, !!eng.diesel);
    Physics.applyTuning(cfg); Sound.setAls && Sound.setAls(Physics.P.als);
    if (parent) parent.add(car.root);
    const L = $('logoModel'); if (L) { L.textContent = (car.spec.logo || car.spec.id).toUpperCase(); $('logoSub').textContent = (car.spec.logoSub || car.spec.name).toUpperCase(); }
  }
  function markShadows() {
    car.root.traverse(o => { if (o.isMesh) o.castShadow = o.material && o.material.type !== 'ShaderMaterial'; });
  }

  // ---------- Garage-Szene ----------
  function buildGarage() {
    const s = new T.Scene();
    s.background = new T.Color(0x0c0e13);
    s.fog = new T.Fog(0x0c0e13, 20, 50);
    const toon = E46.toon, real = E46.mat.real;
    const basic = (c, o) => new T.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
    const box = (w, h, d, x, y, z, m, cast) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); if (cast) b.castShadow = true; b.receiveShadow = true; s.add(b); return b; };
    const cyl = (r, h, x, y, z, m, seg) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, h, seg || 18), m); o.position.set(x, y, z); o.castShadow = true; s.add(o); return o; };
    const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.anisotropy = 8; return t; };
    // Licht: weiches Grundlicht, Hauptlicht mit Schatten, zwei farbige Streiflichter
    s.add(new T.HemisphereLight(0xdde6ff, 0x2a2622, 0.5));
    const key = new T.DirectionalLight(0xffffff, 0.82);
    key.position.set(5, 9, 6); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
    key.shadow.bias = -0.0006;
    s.add(key);
    const rimL = new T.DirectionalLight(0x6fa8ff, 0.5); rimL.position.set(-8, 3, -5); s.add(rimL);
    const rimR = new T.DirectionalLight(0xffa860, 0.38); rimR.position.set(8, 2, -6); s.add(rimR);

    // Boden: dunkle, leicht spiegelnde Fliesen
    const tt = canvas(512, 512, (g, w, h) => {
      g.fillStyle = '#32353c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) { g.fillStyle = Math.random() < 0.5 ? '#2c2f36' : '#393c44'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.strokeStyle = '#1b1d22'; g.lineWidth = 5; g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2; g.strokeRect(4, 4, w / 2 - 8, h / 2 - 8); g.strokeRect(w / 2 + 4, h / 2 + 4, w / 2 - 8, h / 2 - 8);
    });
    tt.wrapS = tt.wrapT = T.RepeatWrapping; tt.repeat.set(16, 16);
    const floor = new T.Mesh(new T.PlaneGeometry(80, 80), real(0xffffff, 0.62, 0.1, { map: tt, side: T.FrontSide, envMapIntensity: 0.16 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    // Lichtkegel auf dem Boden rund um den Drehteller
    const glow = canvas(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    const spot = new T.Mesh(new T.PlaneGeometry(22, 22), basic(0xdfe8ff, { map: glow, transparent: true, opacity: 0.09, depthWrite: false, blending: T.AdditiveBlending }));
    spot.rotation.x = -Math.PI / 2; spot.position.y = 0.012; s.add(spot);
    // Drehteller mit Leuchtring
    const plat = new T.Mesh(new T.CylinderGeometry(3.8, 3.9, 0.08, 72), real(0x1d1f24, 0.5, 0.6, { envMapIntensity: 0.3 }));
    plat.position.y = 0.04; plat.receiveShadow = true; s.add(plat);
    const ring = new T.Mesh(new T.RingGeometry(3.56, 3.7, 72), basic(0xffd21f));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.083; s.add(ring);
    const ring2 = new T.Mesh(new T.RingGeometry(3.92, 4.0, 72), basic(0x3a3f4a));
    ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.014; s.add(ring2);
    // Markierungen auf dem Teller (drehen mit)
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const m = new T.Mesh(new T.PlaneGeometry(i % 6 ? 0.22 : 0.42, 0.05), basic(0x6a7080)); m.rotation.x = -Math.PI / 2; m.rotation.z = -a; m.position.set(Math.cos(a) * 3.3, 0.041, Math.sin(a) * 3.3); plat.add(m); }

    // Wände: dunkle Paneele, Sockel, Lichtlinien
    const wt = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#2c3038'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) { g.fillStyle = Math.random() < 0.5 ? '#292d35' : '#30343d'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      for (let x = 0; x < w; x += 64) { g.fillStyle = '#1c1f25'; g.fillRect(x, 0, 3, h); g.fillStyle = '#3a3f49'; g.fillRect(x + 3, 0, 2, h); }
      g.fillStyle = '#1c1f25'; g.fillRect(0, 0, w, 3);
    });
    wt.wrapS = wt.wrapT = T.RepeatWrapping;
    const wtB = wt.clone(); wtB.needsUpdate = true; wtB.repeat.set(10, 2); const wtS = wt.clone(); wtS.needsUpdate = true; wtS.repeat.set(7.5, 2);
    const darkM = toon(0x15171b), steelM = toon(0x8d9299);
    box(40, 9, 0.4, 0, 4.5, -10, toon(0xffffff, { map: wtB }));
    box(0.4, 9, 30, -14, 4.5, 4, [toon(0xffffff, { map: wtS }), toon(0xffffff, { map: wtS }), darkM, darkM, darkM, darkM]);
    box(40, 0.5, 0.1, 0, 0.25, -9.76, darkM); box(0.1, 0.5, 30, -13.76, 0.25, 4, darkM);
    const led = basic(0xffd21f), ledW = basic(0xe6eeff);
    box(40, 0.06, 0.05, 0, 0.56, -9.74, led); box(0.05, 0.06, 30, -13.74, 0.56, 4, led);
    box(40, 0.09, 0.06, 0, 5.35, -9.74, ledW); box(0.06, 0.09, 30, -13.74, 5.35, 4, ledW);
    // Rolltore rechts
    const stx = canvas(256, 256, (g) => { g.fillStyle = '#767c85'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 16) { g.fillStyle = '#5f656e'; g.fillRect(0, y, 256, 3); g.fillStyle = '#8b919a'; g.fillRect(0, y + 3, 256, 2); } });
    stx.wrapS = stx.wrapT = T.RepeatWrapping; stx.repeat.set(1, 2);
    for (const x of [4.6, 11.2]) {
      const sh = new T.Mesh(new T.PlaneGeometry(5.2, 4.4), toon(0xffffff, { map: stx })); sh.position.set(x, 2.2, -9.78); s.add(sh);
      box(5.7, 0.35, 0.3, x, 4.58, -9.7, darkM); for (const dx of [-2.75, 2.75]) box(0.22, 4.4, 0.25, x + dx, 2.2, -9.72, darkM);
      const hz = canvas(256, 32, (g, w, h) => { g.fillStyle = '#f2c21b'; g.fillRect(0, 0, w, h); g.fillStyle = '#17181b'; for (let i = -1; i < 9; i++) { g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 16, h); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 32, 0); g.fill(); } });
      const hm = new T.Mesh(new T.PlaneGeometry(5.2, 0.3), toon(0xffffff, { map: hz })); hm.position.set(x, 0.16, -9.77); s.add(hm);
    }
    // drei schräge Farbstreifen an der Rückwand
    [0x6fb5ff, 0x1c3f94, 0xe2252b].forEach((c, i) => {
      const x0 = -1.2 + i * 0.62, g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([x0, 0.6, 0, x0 + 0.5, 0.6, 0, x0 + 2.3, 5.3, 0, x0 + 1.8, 5.3, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new T.Mesh(g, basic(c)); m.position.z = -9.77; s.add(m);
    });
    // Leuchtschrift
    const sc = canvas(1024, 256, (g) => {
      g.font = 'italic 900 128px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff3b6b'; g.shadowBlur = 34; g.fillStyle = '#ffe4ec'; g.fillText('DRIFT GARAGE', 512, 112); g.fillText('DRIFT GARAGE', 512, 112);
      g.shadowColor = '#3bd8ff'; g.shadowBlur = 22; g.fillStyle = '#d9f7ff'; g.fillRect(150, 200, 724, 9);
    });
    const sign = new T.Mesh(new T.PlaneGeometry(9, 2.25), basic(0xffffff, { map: sc, transparent: true }));
    sign.position.set(-7.4, 3.6, -9.76); s.add(sign);
    // Werkzeugwagen und Lochwand hinten links
    const cabTex = canvas(128, 128, (g, w, h) => { g.fillStyle = '#c8262a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { const y = 6 + i * 20; g.fillStyle = '#8f1519'; g.fillRect(6, y, w - 12, 17); g.fillStyle = '#d6383c'; g.fillRect(8, y + 1, w - 16, 14); g.fillStyle = '#d9dde2'; g.fillRect(34, y + 5, w - 68, 4); } });
    const cabF = toon(0xffffff, { map: cabTex }), cabS = toon(0xc8262a);
    for (let i = 0; i < 4; i++) box(0.95, 1.1, 0.6, -12.6 + i * 1.02, 0.6, -9.3, [cabS, cabS, darkM, cabS, cabF, cabS], true);
    box(4.1, 0.07, 0.66, -11.07, 1.19, -9.3, toon(0xb07a45), true);
    box(0.6, 0.3, 0.36, -12.2, 1.38, -9.3, toon(0x1f5fd6), true);
    // Reifenstapel, Fässer
    const tg = new T.CylinderGeometry(0.34, 0.34, 0.24, 18), tm = toon(0x1c1d20), rimM = real(0xc9a33a, 0.25, 0.9);
    for (const [x, z, n, rim] of [[-3.4, -8.6, 5, 1], [-2.5, -8.9, 4, 0], [8.0, -8.4, 6, 1], [-9.8, 4.5, 3, 0], [-10.6, 3.6, 4, 1]]) {
      for (let k = 0; k < n; k++) { const t = new T.Mesh(tg, tm); t.position.set(x, 0.12 + k * 0.24, z); t.castShadow = true; s.add(t); }
      if (rim) cyl(0.22, 0.1, x, n * 0.24 + 0.02, z, rimM);
    }
    cyl(0.29, 0.88, 1.2, 0.44, -9.2, toon(0x1f5fd6)); cyl(0.29, 0.88, 1.9, 0.44, -9.0, toon(0xd32b2b));
    // Regal mit Reifen und Felgen an der Seitenwand
    {
      const fr = toon(0x3f5f8f), tg2 = new T.CylinderGeometry(0.34, 0.34, 0.24, 18); tg2.rotateX(Math.PI / 2);
      for (const z of [-4.2, 0.2, 4.6]) for (const dx of [0.15, 0.75]) box(0.07, 3.6, 0.07, -13.75 + dx, 1.8, z, fr);
      for (const y of [0.2, 1.3, 2.4, 3.5]) box(0.7, 0.06, 8.9, -13.3, y, 0.2, fr);
      for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 14; i++) {
        if ((i + lv * 3) % 7 === 6) continue;
        const z = -3.9 + i * 0.6, y = 0.2 + lv * 1.1 + 0.37;
        const t = new T.Mesh(tg2, tm); t.rotation.y = Math.PI / 2; t.position.set(-13.3, y, z); s.add(t);
        if ((i + lv) % 3 === 0) { const r = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.26, 16), (i + lv) % 2 ? rimM : real(0xaab2bc, 0.25, 0.9)); r.rotation.z = Math.PI / 2; r.position.set(-13.3, y, z); s.add(r); }
      }
    }
    // Deckenlampen
    for (let i = -2; i <= 2; i++) box(2.6, 0.08, 0.4, i * 4, 8.6, -3, basic(0xffffff));
    s.userData.plat = plat;
    return s;
  }

  // ---------- UI ----------
  function buildUI() {
    // Tabs
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tabbody').forEach(x => x.classList.toggle('hidden', x.id !== 'tab-' + b.dataset.tab));
    }));
    // Fahrzeugwahl
    for (const id of window.CAR_ORDER) {
      const M = window.CAR_MODELS[id];
      Physics.applyTuning(Object.assign({}, TUNE_DEF, { model: id }));
      const ps = Physics.peakPS();
      const b = document.createElement('button'); b.className = 'model'; b.dataset.id = id;
      b.innerHTML = '<div class="mi"><div class="mn">' + M.name + '</div><div class="ms">' + M.sub + '<br>' + M.engine + '</div></div><div class="mp">' + ps + '<small>PS Serie</small></div>';
      b.addEventListener('click', () => {
        if (cfg.model === id) return;
        b.classList.add('loading');
        setTimeout(() => {
          stashTune(); cfg.model = id; restoreTune(); buildCar();
          if (mode === 'garage') { car.root.position.set(0, 0.08, 0); car.root.rotation.set(0, garageTurn, 0); car.update({ frontSpin: 0, rearSpin: 0, steer: 0.38, roll: 0, pitch: 0 }); }
          Physics.applyTuning(cfg); save(); refreshUI(); b.classList.remove('loading');
        }, 30);
      });
      $('models').appendChild(b);
    }
    Physics.applyTuning(cfg);
    // Motorwahl (nur bei Autos mit mehreren Motoren)
    $('engines').addEventListener('click', (e) => {
      const b = e.target.closest('.model'); if (!b) return;
      const i = +b.dataset.i;
      if (((cfg.engines || {})[cfg.model] | 0) === i) return;
      cfg.engines = Object.assign({}, cfg.engines, { [cfg.model]: i });
      b.classList.add('loading');
      setTimeout(() => {
        buildCar();
        if (mode === 'garage') { car.root.position.set(0, 0.08, 0); car.root.rotation.set(0, garageTurn, 0); car.update({ frontSpin: 0, rearSpin: 0, steer: 0.38, roll: 0, pitch: 0 }); }
        Physics.applyTuning(cfg); save(); refreshUI();
      }, 30);
    });
    // Streckenwahl
    for (const id of Track.ORDER) {
      const MM = Track.MAPS[id];
      const b = document.createElement('button'); b.className = 'model map'; b.dataset.id = id;
      b.innerHTML = '<div class="mi"><div class="mn">' + MM.name + '</div><div class="ms">' + MM.desc + '</div></div>';
      b.addEventListener('click', () => {
        if (cfg.map === id) return;
        b.classList.add('loading');
        setTimeout(() => { switchMap(id); refreshUI(); b.classList.remove('loading'); }, 30);
      });
      $('maps').appendChild(b);
    }
    $('fuelBtn').addEventListener('click', () => { cfg.fuelOn = !cfg.fuelOn; save(); refreshUI(); });
    // Lacke
    const pw = $('paints');
    E46.PAINTS.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'sw'; d.title = p.name;
      d.style.background = '#' + p.hex.toString(16).padStart(6, '0');
      d.addEventListener('click', () => {
        if (Prog.hasPaint(i)) { arm(null); cfg.paint = i; car.setPaint(p.hex); save(); refreshUI(); return; }
        // noch nicht gekauft: Vorschau am Auto, zweiter Klick kauft
        const lv = Prog.paintLevel(i), pr = Prog.paintPrice(i), key = 'paint:' + i;
        let msg;
        if (Prog.level() < lv) { arm('preview'); msg = '🔒 ab Level ' + lv + ' · ' + fmt(pr) + ' €'; }
        else if (Prog.money() < pr) { arm('preview'); msg = fmt(pr) + ' € · zu wenig Geld'; }
        else if (armed !== key) { arm(key); msg = fmt(pr) + ' € · nochmal klicken zum Kaufen'; }
        else {
          arm(null); Prog.buyPaint(i); cfg.paint = i; car.setPaint(p.hex); save(); refreshUI();
          padToast('🎨 ' + p.name + ' gekauft · −' + fmt(pr) + ' €'); return;
        }
        car.setPaint(p.hex);
        $('paintName').textContent = p.name + ' · ' + msg;
      });
      pw.appendChild(d);
    });
    E46.FINISHES.forEach((f, i) => {
      const b = document.createElement('button'); b.className = 'chip';
      b.addEventListener('click', () => {
        if (!Prog.hasFinish(i)) {
          const F = Prog.FINISH[i];
          if (Prog.level() < F.lvl) { padToast('🔒 ' + f.name + ' erst ab Level ' + F.lvl); return; }
          if (Prog.money() < F.price) { padToast('Zu wenig Geld: ' + f.name + ' kostet ' + fmt(F.price) + ' €'); return; }
          if (armed !== 'fin:' + i) { arm('fin:' + i); return; }
          arm(null); Prog.buyFinish(i); padToast('✨ Finish ' + f.name + ' gekauft · −' + fmt(F.price) + ' €');
        }
        cfg.finish = i; applyLook();
      });
      $('finishes').appendChild(b);
    });
    // Kackhaufen-Tarnung (nur Jonnys Rollstuhl): einmal kaufen, dann an/aus
    document.querySelectorAll('#camos .chip').forEach((b) => {
      b.addEventListener('click', () => {
        const on = b.dataset.camo === '1';
        if (on && !Prog.hasCamo()) {
          const C = Prog.CAMO;
          if (Prog.level() < C.lvl) { padToast('🔒 Kackhaufen-Tarnung erst ab Level ' + C.lvl); return; }
          if (Prog.money() < C.price) { padToast('Zu wenig Geld: Kackhaufen-Tarnung kostet ' + fmt(C.price) + ' €'); return; }
          if (armed !== 'camo') { arm('camo'); if (car.setCamo) car.setCamo(true); return; }   // erster Klick: Vorschau
          arm(null); Prog.buyCamo(); padToast('💩 Kackhaufen-Tarnung gekauft · −' + fmt(C.price) + ' €');
        }
        cfg.camo = on; applyLook();
      });
    });
    // Tageszeit
    Sky.MODES.forEach((m) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = m.name; b.dataset.id = m.id;
      b.addEventListener('click', () => { cfg.tod = m.id; save(); refreshUI(); });
      $('tods').appendChild(b);
    });
    $('fxBtn').addEventListener('click', () => { cfg.fx = cfg.fx === false; post.enabled = cfg.fx; save(); refreshUI(); });
    const rw = $('rims');
    E46.RIMS.forEach((r, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = r.name;
      b.addEventListener('click', () => { cfg.rimStyle = i; car.setRimStyle(i); markShadows(); save(); refreshUI(); });
      rw.appendChild(b);
    });
    E46.RIM_SIZES.forEach((z, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = z.name;
      b.addEventListener('click', () => { cfg.rimSize = i; car.setWheelOpts({ size: i }); markShadows(); save(); refreshUI(); });
      $('rimSizes').appendChild(b);
    });
    E46.LIP_COLORS.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = c.name;
      if (c.hex != null) b.style.boxShadow = 'inset 0 -4px 0 #' + c.hex.toString(16).padStart(6, '0');
      b.addEventListener('click', () => { cfg.lipColor = i; car.setWheelOpts({ lip: c.hex }); save(); refreshUI(); });
      $('lipColors').appendChild(b);
    });
    $('lettersBtn').addEventListener('click', () => { cfg.letters = !cfg.letters; car.setWheelOpts({ letters: cfg.letters }); markShadows(); save(); refreshUI(); });
    const rc = $('rimColors');
    E46.RIM_COLORS.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'sw'; d.title = c.name;
      d.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      d.addEventListener('click', () => { cfg.rimColor = i; car.setRimColor(c.hex); save(); refreshUI(); });
      rc.appendChild(d);
    });
    const sliders = [['drop', v => v + ' cm'], ['camber', v => '-' + v + '°'], ['track', v => '+' + v + ' cm'], ['assist', v => v + ' %'], ['maxang', v => v + '°'],
      ['pressF', v => v.toFixed(1).replace('.', ',') + ' bar'], ['pressR', v => v.toFixed(1).replace('.', ',') + ' bar'], ['lsd', v => v === 0 ? 'offen' : v + ' %'], ['stabi', v => v + ' %']];
    for (const [id, fmt] of sliders) {
      const el = $(id); el.value = cfg[id];
      const upd = () => {
        cfg[id] = parseFloat(el.value); $(id + 'V').textContent = fmt(cfg[id]);
        car.setStance({ drop: cfg.drop / 100, camber: cfg.camber, track: cfg.track / 100 });
        Physics.applyTuning(cfg);
        save();
      };
      el.addEventListener('input', upd); upd();
    }
    refreshStanceSliders = () => { for (const [id, f] of sliders) { $(id).value = cfg[id]; $(id + 'V').textContent = f(+cfg[id]); } };
    // --- Motor-Tuning ---
    const tuneSl = [['power', v => v + ' %'], ['turbo', v => v ? '+' + Math.round(v * 0.45) + ' %' : 'aus'], ['finalPct', () => Physics.P.final.toFixed(2).replace('.', ',')], ['weightPct', () => Math.round(Physics.P.mass) + ' kg'],
      ['brakePower', v => v + ' %'], ['brakeBias', v => v + ' %'], ['steerSpeed', v => v + ' %'], ['lock', v => v + '°'], ['hbrake', v => v + ' %'], ['roll', v => v + ' %'], ['soot', v => v + ' %'], ['backfire', v => v ? v + ' %' : 'aus']];
    for (const [id, f] of tuneSl) {
      const el = $(id);
      el.addEventListener('input', () => { cfg[id] = parseFloat(el.value); Physics.applyTuning(cfg); $(id + 'V').textContent = f(cfg[id]); updateStats(); save(); });
    }
    refreshTuneSliders = () => { for (const [id, f] of tuneSl) { $(id).value = cfg[id]; $(id + 'V').textContent = f(+cfg[id]); } };
    Physics.TIRES.forEach((t, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = t.name;
      b.addEventListener('click', () => {
        if (!Prog.hasTire(cfg.model, i)) {
          const T0 = Prog.TIRES[i], pr = Prog.tirePrice(i, stockInfo().ps);
          if (Prog.level() < T0.lvl) { padToast('🔒 ' + t.name + ' erst ab Level ' + T0.lvl); return; }
          if (Prog.money() < pr) { padToast('Zu wenig Geld: ' + t.name + ' kostet ' + fmt(pr) + ' €'); return; }
          if (armed !== 'tire:' + i) { arm('tire:' + i); return; }
          arm(null); Prog.buyTire(cfg.model, i, stockInfo().ps); padToast('🛞 ' + t.name + ' gekauft · −' + fmt(pr) + ' €');
        }
        cfg.tires = i; Physics.applyTuning(cfg); save(); refreshUI();
      });
      $('tires').appendChild(b);
    });
    $('tuneReset').addEventListener('click', () => { Object.assign(cfg, TUNE_DEF); Physics.applyTuning(cfg); save(); refreshUI(); });
    $('shop').addEventListener('click', (e) => {
      const b = e.target.closest('.buy'); if (!b || b.disabled) return;
      const id = b.dataset.part, key = 'part:' + id;
      if (armed !== key) { arm(key); return; }
      arm(null);
      const si = stockInfo(), s = Prog.stage(cfg.model, id) + 1, pr = Prog.partPrice(id, s, si.ps, si.sauger);
      const err = Prog.buyPart(cfg.model, id, si.ps, si.sauger);
      if (err) { padToast(err); refreshUI(); return; }
      // neu gekauftes Teil gleich voll einstellen
      const L = Prog.limits(cfg.model);
      if (id === 'power') cfg.power = L.powerMax;
      if (id === 'turbo') cfg.turbo = L.turboMax;
      if (id === 'weight') cfg.weightPct = L.weightMin;
      if (id === 'brake') cfg.brakePower = L.brakeMax;
      if (id === 'als') cfg.als = true;
      Physics.applyTuning(cfg); Sound.setAls && Sound.setAls(Physics.P.als); save(); refreshUI();
      padToast('🔧 ' + Prog.PARTS[id].name + (Prog.PARTS[id].stages > 1 ? ' Stufe ' + s : '') + ' eingebaut · −' + fmt(pr) + ' €');
    });
    // --- Optik ---
    E46.SMOKE_COLORS.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'sw'; d.title = c.name;
      d.style.background = 'rgb(' + c.rgb.map(v => Math.round(v * 255)).join(',') + ')';
      d.addEventListener('click', () => { cfg.smoke = i; save(); refreshUI(); });
      $('smokeColors').appendChild(d);
    });
    E46.NEON_COLORS.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = c.name;
      if (c.hex) b.style.boxShadow = 'inset 0 -4px 0 #' + c.hex.toString(16).padStart(6, '0');
      b.addEventListener('click', () => { cfg.neon = i; applyLook(); });
      $('neons').appendChild(b);
    });
    E46.CALIPER_COLORS.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'sw'; d.title = c.name;
      d.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      d.addEventListener('click', () => { cfg.caliper = i; applyLook(); });
      $('calipers').appendChild(d);
    });
    ['Serie', 'GT-Flügel', 'Ohne', 'Dachspoiler XL', 'Swan-Neck', 'Time Attack', 'Entenbürzel'].forEach((n, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = n;
      b.addEventListener('click', () => { cfg.spoiler = i; applyLook(); });
      $('spoilers').appendChild(b);
    });
    E46.ANGEL_COLORS.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = c.name;
      b.style.boxShadow = 'inset 0 -4px 0 #' + c.hex.toString(16).padStart(6, '0');
      b.addEventListener('click', () => { cfg.angel = i; applyLook(); });
      $('angels').appendChild(b);
    });
    const tintEl = $('tint');
    tintEl.addEventListener('input', () => { cfg.tint = +tintEl.value; applyLook(); });
    $('lipBtn').addEventListener('click', () => { cfg.lip = !cfg.lip; applyLook(); });
    $('sunroofBtn').addEventListener('click', () => { cfg.sunroof = !cfg.sunroof; applyLook(); });
    $('towBtn').addEventListener('click', () => { cfg.tow = !cfg.tow; applyLook(); });
    $('flamesBtn').addEventListener('click', () => { cfg.flames = !cfg.flames; save(); refreshUI(); });
    $('downBtn').addEventListener('click', () => { cfg.downPops = cfg.downPops === false; save(); refreshUI(); });
    $('alsBtn').addEventListener('click', () => { if (!Physics.P.hasTurbo) return; if (!Prog.limits(cfg.model).als) { padToast('Anti-Lag erst oben bei „Teile kaufen“ einbauen'); return; } cfg.als = !cfg.als; Physics.applyTuning(cfg); Sound.setAls && Sound.setAls(Physics.P.als); save(); refreshUI(); });
    const pl = $('plateInput');
    pl.value = cfg.plate;
    pl.addEventListener('input', () => { cfg.plate = pl.value.toUpperCase().replace(/[^A-Z0-9ÄÖÜ ·\-]/g, '').slice(0, 10) || 'M·E 46'; applyLook(); });
    pl.addEventListener('keydown', e => { if (e.code === 'Enter') pl.blur(); });

    $('gearbox').addEventListener('click', () => { cfg.auto = !cfg.auto; save(); refreshUI(); });
    // Lenkrad
    $('wheelBtn').addEventListener('click', () => { wheel.mode = { auto: 'on', on: 'off', off: 'auto' }[wheel.mode]; saveWheel(); refreshWheelUI(); });
    { const el = $('wheelRange'); el.value = wheel.range; const upd = () => { wheel.range = +el.value; $('wheelRangeV').textContent = wheel.range + '°'; saveWheel(); }; el.addEventListener('input', upd); upd(); }
    $('ffbBtn').addEventListener('click', async () => {
      if (!window.FFB) return;
      if (FFB.connected) { ffb.testT = 1.4; return; }
      if (await FFB.connect()) { padToast('🏎 Force Feedback aktiv'); ffb.testT = 1.4; }
      refreshWheelUI();
    });
    { const el = $('ffbStr'); el.value = wheel.ffb; const upd = () => { wheel.ffb = +el.value; $('ffbStrV').textContent = wheel.ffb + ' %'; saveWheel(); }; el.addEventListener('input', upd); upd(); }
    { const b = $('ffbInv'), upd = () => { b.textContent = wheel.ffbInv ? 'UMGEKEHRT' : 'NORMAL'; }; b.addEventListener('click', () => { wheel.ffbInv = !wheel.ffbInv; saveWheel(); upd(); ffb.testT = 1.4; }); upd(); }
    $('wheelCal').addEventListener('click', () => { Object.assign(wiz, { on: true, step: 0, base: null, best: null, held: false }); wizShow(); });
    $('wheelSkip').addEventListener('click', () => { if (wiz.on) wizNext(); });
    $('wheelStop').addEventListener('click', () => { wiz.on = false; wizShow(); });
    refreshWheelUI();
    $('smokeBtn').addEventListener('click', () => { cfg.smokeOn = !cfg.smokeOn; applySmoke(); save(); refreshUI(); });
    $('soundBtn').addEventListener('click', () => { cfg.sound = !cfg.sound; Sound.setMuted(!cfg.sound); save(); refreshUI(); });
    // Gesamtlautstärke (Garage + Pausenmenü)
    for (const id of ['volume', 'pVolume']) {
      $(id).addEventListener('input', () => {
        cfg.volume = +$(id).value; Sound.setVolume(cfg.volume / 100);
        if (cfg.volume > 0 && !cfg.sound) { cfg.sound = true; Sound.setMuted(false); }
        save(); refreshUI();
      });
    }
    $('goBtn').addEventListener('click', startDrive);
    $('chalBtn').addEventListener('click', () => startChallenge('pts'));
    $('lapBtn').addEventListener('click', () => startChallenge('time'));
    $('specBtn').addEventListener('click', enterSpectate);
    $('chalAgainBtn').addEventListener('click', () => { $('chalDone').classList.add('hidden'); restartChallenge(); });
    $('chalGarageBtn').addEventListener('click', () => { $('chalDone').classList.add('hidden'); enterGarage(); });
    const ni = $('mpName');
    ni.value = myName;
    ni.addEventListener('change', () => {
      myName = ni.value.replace(/[<>&"]/g, '').trim().slice(0, 16) || myName; ni.value = myName;
      store('e46drift.name', myName); Net.sendName(myName); refreshMP();
    });
    ni.addEventListener('keydown', e => { if (e.code === 'Enter') ni.blur(); });
    $('resumeBtn').addEventListener('click', () => setPause(false));
    $('resetBtn').addEventListener('click', () => { resetCar(); setPause(false); });
    $('startBtn').addEventListener('click', () => { setPause(false); if (chal.on) restartChallenge(); else backToStart(); });
    $('garageBtn').addEventListener('click', () => { setPause(false); enterGarage(); });

    // Drehen per Maus/Touch
    const cv = renderer.domElement;
    const down = (x) => { if (mode !== 'garage') return; dragging = true; dragX = x; };
    const move = (x) => { if (!dragging) return; const dx = x - dragX; dragX = x; garageTurn += dx * 0.008; dragVel = dx * 0.008; };
    cv.addEventListener('mousedown', e => down(e.clientX));
    window.addEventListener('mousemove', e => move(e.clientX));
    window.addEventListener('mouseup', () => dragging = false);
    cv.addEventListener('touchstart', e => down(e.touches[0].clientX), { passive: true });
    cv.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
    cv.addEventListener('touchend', () => dragging = false);

    // Touch-Steuerung
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      $('touch').classList.remove('hidden');
      document.querySelectorAll('#touch button').forEach(b => {
        const k = b.dataset.k;
        b.addEventListener('touchstart', e => { e.preventDefault(); touch[k] = true; });
        b.addEventListener('touchend', e => { e.preventDefault(); touch[k] = false; });
        b.addEventListener('touchcancel', () => { touch[k] = false; });
      });
    }
    refreshUI();
  }
  function refreshMP() {
    {
      const r = (rec.chal || {})[cfg.map], nm = (Track.MAPS[cfg.map] || {}).name || cfg.map;
      const mh = $('modeHint');
      const lr = (rec.lap || {})[cfg.map];
      if (mh) mh.textContent = nm + ' · Punkte-Rekord: ' + (r ? fmt(r.pts) : 'noch keiner') + ' · Bestzeit: ' + (lr ? fmtLap(lr.time) : 'noch keine') + (Net.connected ? '' : ' · Zuschauen geht nur online');
    }
    if (!$('mpOn')) return;
    $('mpOff').classList.toggle('hidden', Net.available);
    $('mpOn').classList.toggle('hidden', !Net.available);
    if (!Net.available) return;
    $('mpStatus').textContent = Net.status + (Net.connected ? ' (' + (Net.remotes.size + 1) + '/' + (Net.max || 20) + ' Spieler)' : '');
    const rows = [{ name: myName + ' (du)', slot: Net.slot, total: score.total, best: rec.best, bestCar: rec.bestModel || null, me: true }].concat(Net.list());
    $('mpPlayers').innerHTML = rows.map(r => '<div class="mpp"><i style="background:' + Net.slotColor(r.slot) + '"></i>' + esc(r.name) + '<small>Lv ' + (r.me ? Prog.level() : (r.lvl || 1)) + ' · Bester Drift ' + fmt(r.best) + (r.bestCar ? ' · ' + esc(carName(r.bestCar)) : '') + '</small></div>').join('');
    $('mpAdmin').classList.toggle('hidden', !Net.isHost);
    $('mpUrls').innerHTML = (Net.urls.length ? Net.urls : [location.origin]).map(esc).join('<br>');
    const b = $('board');
    if (Net.connected && Net.remotes.size) {
      b.classList.remove('hidden');
      if (chal.on && chal.kind === 'time') {
        // Zeitrennen: Bestzeiten auf dieser Strecke, schnellste zuerst; wer noch keine Zeit hat, steht unten
        const mp = cfg.map, nm = (Track.MAPS[mp] || {}).name || mp, lb = lapBoard(mp);
        const none = rows.filter(r => !lb.some(e => e.me ? r.me : (!r.me && e.name === r.name && e.slot === r.slot)));
        b.innerHTML = '<div class="hdr">ZEITRENNEN · ' + esc(nm).toUpperCase() + '</div>' +
          lb.map((e, i) => '<div class="row' + (e.me ? ' me' : '') + '"><i style="background:' + Net.slotColor(e.slot) + '"></i><span>' + (i === 0 ? '🏆 ' : '') + esc(e.name) + '</span>' + (e.model ? '<small class="car">' + esc(carName(e.model)) + '</small>' : '') + '<span>' + fmtLap(e.time) + '</span></div>').join('') +
          none.map(r => '<div class="row' + (r.me ? ' me' : '') + '"><i style="background:' + Net.slotColor(r.slot) + '"></i><span>' + esc(r.me ? myName : r.name) + '</span><span>–</span></div>').join(''); trimBoard(b);
        return;
      }
      if (chal.on) {
        // Challenge: Rundenrekorde auf dieser Strecke
        const mp = cfg.map, nm = (Track.MAPS[mp] || {}).name || mp;
        const cr = rows.map(r => ({ r, v: r.me ? ((rec.chal || {})[mp] || {}).pts || 0 : (r.chalRec || {})[mp] || 0, car: r.me ? ((rec.chal || {})[mp] || {}).model : (r.chalCar || {})[mp] })).sort((a, c) => c.v - a.v);
        b.innerHTML = '<div class="hdr">CHALLENGE · ' + esc(nm).toUpperCase() + '</div>' + cr.map(({ r, v, car }) => '<div class="row' + (r.me ? ' me' : '') + '"><i style="background:' + Net.slotColor(r.slot) + '"></i><span>' + esc(r.me ? myName : r.name) + '</span>' + (v && car ? '<small class="car">' + esc(carName(car)) + '</small>' : '') + '<span>' + (v ? fmt(v) : '–') + '</span></div>').join(''); trimBoard(b);
        return;
      }
      rows.sort((a, c) => c.best - a.best);
      b.innerHTML = '<div class="hdr">BESTER DRIFT</div>' + rows.map(r => '<div class="row' + (r.me ? ' me' : '') + '"><i style="background:' + Net.slotColor(r.slot) + '"></i><span>' + esc(r.me ? myName : r.name) + '</span>' + (r.best && r.bestCar ? '<small class="car">' + esc(carName(r.bestCar)) + '</small>' : '') + '<span>' + fmt(r.best) + '</span></div>').join(''); trimBoard(b);
    } else b.classList.add('hidden');
  }
  // Rangliste im Spiel kurz halten (bei bis zu 20 Spielern): die ersten 8, die eigene Zeile bleibt immer sichtbar
  function trimBoard(b) {
    const rows = [...b.querySelectorAll('.row')], MAXR = 8;
    if (rows.length <= MAXR) return;
    const me = rows.findIndex(r => r.classList.contains('me'));
    rows.forEach((r, i) => { if (i >= MAXR - (me >= MAXR ? 1 : 0) && i !== me) r.remove(); });
    const more = document.createElement('div'); more.className = 'row'; more.style.opacity = '0.7';
    more.innerHTML = '<span>+ ' + (rows.length - MAXR) + ' weitere</span>'; b.appendChild(more);
  }
  const carName = (id) => (window.CAR_MODELS[id] || {}).name || id;
  const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let refreshTuneSliders = () => {}, refreshStanceSliders = () => {};
  // Rauch komplett aus-/einblenden (eigener + fremder, Reifen + Diesel)
  function applySmoke() { smoke.enabled = cfg.smokeOn !== false; if (!smoke.enabled) smoke.clear(); smoke.points.visible = smoke.enabled; }
  function applyLook() { car.setLook(E46.lookFromCfg(cfg)); save(); refreshUI(); }
  function updateStats() {
    const ps = Physics.peakPS(), kg = Math.round(Physics.P.mass);
    $('statPS').textContent = ps; $('statKG').textContent = kg;
    $('statRatio').textContent = (kg / ps).toFixed(1).replace('.', ',');
  }
  // ---------- Level, Geld & Shop ----------
  const CAR_TUNE = ['power', 'turbo', 'weightPct', 'brakePower', 'tires', 'als'];
  function stashTune() { cfg.carTune = Object.assign({}, cfg.carTune); const o = {}; for (const k of CAR_TUNE) o[k] = cfg[k]; cfg.carTune[cfg.model] = o; }
  function restoreTune() {
    const o = (cfg.carTune || {})[cfg.model] || {};
    for (const k of CAR_TUNE) cfg[k] = o[k] != null ? o[k] : (TUNE_DEF[k] != null ? TUNE_DEF[k] : false);
    Prog.clampCfg(cfg);
  }
  // Serienleistung und ob das Auto ab Werk einen Turbo hat (für die Preise)
  function stockInfo() {
    Physics.applyTuning(Object.assign({}, cfg, TUNE_DEF, { als: false }));
    const r = { ps: Physics.peakPS(), sauger: !Physics.P.hasTurbo, turbo: Physics.P.hasTurbo };
    Physics.applyTuning(cfg);
    return r;
  }
  // Kaufen geht mit zwei Klicks: der erste „schärft“ den Knopf für 3 s
  let armed = null, armT = null;
  function arm(key) {
    armed = key; clearTimeout(armT);
    // Vorschau zurücksetzen (Lack und Tarnung wie gespeichert)
    const restore = () => { if (car) { car.setPaint(E46.PAINTS[cfg.paint].hex); if (car.setCamo) car.setCamo(cfg.camo); } };
    if (key) armT = setTimeout(() => { armed = null; restore(); refreshUI(); }, 3000);
    else restore();
    refreshUI();
  }
  function updateProg() {
    const li = Prog.levelInfo(), pct = li.max ? 100 : li.into / li.need * 100, m = fmt(Prog.money()) + ' €';
    $('pLvl').textContent = li.level; $('hLvl').textContent = li.level;
    $('pFill').style.width = pct + '%'; $('hFill').style.width = pct + '%';
    $('pXp').textContent = li.max ? 'MAX-LEVEL' : fmt(li.into) + ' / ' + fmt(li.need) + ' XP';
    $('pMoney').textContent = m; $('hMoney').textContent = m;
  }
  function setRange(id, min, max) { const el = $(id); el.min = min; el.max = max; el.disabled = max <= min; }
  function renderShop() {
    const si = stockInfo(), lvl = Prog.level(), money = Prog.money();
    const L = Prog.limits(cfg.model);
    setRange('power', 70, L.powerMax); setRange('turbo', 0, L.turboMax); setRange('weightPct', L.weightMin, 110); setRange('brakePower', 60, L.brakeMax);
    $('shopCar').textContent = '· ' + carName(cfg.model) + ' · Serie ' + si.ps + ' PS';
    const hasTurbo = si.turbo || Prog.stage(cfg.model, 'turbo') > 0;
    $('shop').innerHTML = Prog.PART_ORDER.map(id => {
      const P = Prog.PARTS[id], s = Prog.stage(cfg.model, id), n = s + 1, multi = P.stages > 1;
      let cls = '', top, sub;
      if (s >= P.stages) { cls = 'maxed'; top = 'MAX'; sub = multi ? 'voll ausgebaut' : 'eingebaut'; }
      else if (id === 'als' && (!hasTurbo || Physics.P.electric)) { cls = 'locked'; top = Physics.P.electric ? 'GEHT NICHT' : 'ERST TURBO'; sub = 'kein Turbo'; }
      else {
        const need = Prog.partLevel(id, n), pr = Prog.partPrice(id, n, si.ps, si.sauger);
        sub = fmt(pr) + ' €';
        if (lvl < need) { cls = 'locked'; top = '🔒 LEVEL ' + need; }
        else if (money < pr) { cls = 'poor'; top = multi ? 'STUFE ' + n : 'KAUFEN'; }
        else if (armed === 'part:' + id) { cls = 'armed'; top = 'WIRKLICH?'; }
        else top = multi ? 'STUFE ' + n : 'KAUFEN';
      }
      const pips = multi ? '<div class="pips">' + Array.from({ length: P.stages }, (_, k) => '<i' + (k < s ? ' class="on"' : '') + '></i>').join('') + '</div>' : '';
      const off = cls === 'locked' || cls === 'maxed' || cls === 'poor';
      return '<div class="part"><div class="pn">' + P.name + '<small>' + (multi ? 'Stufe ' + s + '/' + P.stages + ' · ' : '') + P.info(s) + '</small>' + pips + '</div>'
        + '<button class="buy ' + cls + '" data-part="' + id + '"' + (off ? ' disabled' : '') + '>' + top + '<small>' + sub + '</small></button></div>';
    }).join('');
    // Reifen
    document.querySelectorAll('#tires .chip').forEach((d, i) => {
      const own = Prog.hasTire(cfg.model, i), T0 = Prog.TIRES[i], nm = Physics.TIRES[i].name;
      d.classList.toggle('locked', !own); d.classList.toggle('armed', armed === 'tire:' + i);
      d.innerHTML = nm + (own ? '' : '<small>' + (lvl < T0.lvl ? '🔒 Level ' + T0.lvl : (armed === 'tire:' + i ? 'KAUFEN? ' : '') + fmt(Prog.tirePrice(i, si.ps)) + ' €') + '</small>');
    });
    // Lacke
    document.querySelectorAll('#paints .sw').forEach((d, i) => {
      const own = Prog.hasPaint(i);
      d.classList.toggle('locked', !own);
      d.title = E46.PAINTS[i].name + (own ? '' : ' · ab Level ' + Prog.paintLevel(i) + ' · ' + fmt(Prog.paintPrice(i)) + ' €');
    });
    updateProg();
  }
  function reward(pts) {
    const rw = Prog.addDrift(pts);
    if (rw.up) {
      cfg.lvl = rw.level; save();
      const un = rw.unlocked.length ? rw.unlocked.slice(0, 3).join(', ') + (rw.unlocked.length > 3 ? ' …' : '') : 'Weiter so!';
      setTimeout(() => popup('LEVEL ' + rw.level + '!', '+' + fmt(rw.bonus) + ' € Bonus · ' + un, 'lvl'), 1100);
      chatAdd({ kind: 'sys', text: 'Level ' + rw.level + ' erreicht! +' + fmt(rw.bonus) + ' € Bonus' + (rw.unlocked.length ? ' · Neu: ' + rw.unlocked.join(', ') : '') });
      rumble(0.5, 0.5, 300);
    }
    updateProg();
    return rw;
  }

  function refreshUI() {
    // Motorwahl für das aktuelle Auto
    {
      const list = Physics.ENGINES[cfg.model] || [], cur = (cfg.engines || {})[cfg.model] | 0;
      $('engLabel').classList.toggle('hidden', list.length < 2); $('engines').classList.toggle('hidden', list.length < 2);
      $('engines').innerHTML = list.length < 2 ? '' : list.map((e, i) => {
        Physics.applyTuning(Object.assign({}, cfg, { engines: { [cfg.model]: i }, power: 100, turbo: 0 }));
        return '<button class="model' + (i === cur ? ' active' : '') + '" data-i="' + i + '"><div class="mi"><div class="mn">' + e.name + '</div><div class="ms">' + e.code + '</div></div><div class="mp">' + Physics.peakPS() + '<small>PS Serie</small></div></button>';
      }).join('');
    }
    if (Prog.clampCfg(cfg)) save();
    Physics.applyTuning(cfg);
    renderShop();
    refreshTuneSliders(); refreshStanceSliders(); updateStats();
    document.querySelectorAll('#models .model').forEach(d => d.classList.toggle('active', d.dataset.id === cfg.model));
    document.querySelectorAll('#maps .model').forEach(d => d.classList.toggle('active', d.dataset.id === cfg.map));
    $('fuelBtn').textContent = cfg.fuelOn ? 'AN' : 'AUS';
    document.querySelectorAll('#neons .chip').forEach((d, i) => d.classList.toggle('active', i === (cfg.neon | 0)));
    document.querySelectorAll('#calipers .sw').forEach((d, i) => d.classList.toggle('active', i === (cfg.caliper | 0)));
    { const noBf = Physics.P.diesel || (Physics.P.electric && !Physics.P.flames); $('bfRow').style.opacity = noBf ? 0.4 : 1; $('bfHint').textContent = noBf ? (Physics.P.diesel ? 'Diesel knallen nicht – dafür gibt\'s den Ruß.' : 'E-Antrieb: keine Fehlzündungen.') : 'Knallen und Flammen beim Gaswegnehmen bei hoher Drehzahl: 0 % = aus, 100 % = Serie, 200 % = knallt fast jedes Mal, mehr Nachschüsse, lauter und größere Flammen.'; }
    $('sootRow').style.opacity = car && (car.diesel || car.twoStroke || car.foamAt) ? 1 : 0.4;
    $('sootRow').firstElementChild.textContent = car && car.twoStroke ? 'Zweitakt-Qualm' : car && car.foamAt ? 'Bierschaum' : 'Diesel-Ruß';
    $('alsBtn').textContent = Physics.P.als ? 'AN' : 'AUS';
    $('downBtn').textContent = cfg.downPops === false ? 'AUS' : 'AN';
    $('downRow').style.opacity = Physics.P.electric ? 0.4 : 1;
    $('alsRow').style.opacity = Physics.P.hasTurbo ? 1 : 0.4;
    $('alsHint').textContent = Physics.P.hasTurbo ? 'Hält den Turbo im Schub unter Druck: kein Turboloch, Knallen und Flammen beim Gaswegnehmen.' : (Physics.P.electric ? 'Gibt es nur bei Verbrennern mit Turbo.' : 'Nur mit Turbo: erst das Turbo-Upgrade einstellen.');
    document.querySelectorAll('#tires .chip').forEach((d, i) => d.classList.toggle('active', i === (cfg.tires | 0)));
    document.querySelectorAll('#smokeColors .sw').forEach((d, i) => d.classList.toggle('active', i === (cfg.smoke | 0)));
    document.querySelectorAll('#spoilers .chip').forEach((d, i) => d.classList.toggle('active', i === (cfg.spoiler | 0)));
    document.querySelectorAll('#angels .chip').forEach((d, i) => d.classList.toggle('active', i === (cfg.angel | 0)));
    $('tint').value = cfg.tint; $('tintV').textContent = cfg.tint + ' %';
    if (document.activeElement !== $('plateInput')) $('plateInput').value = cfg.plate;
    $('lipBtn').textContent = cfg.lip ? 'AN' : 'AUS'; $('sunroofBtn').textContent = cfg.sunroof ? 'AN' : 'AUS'; $('towBtn').textContent = cfg.tow ? 'AN' : 'AUS'; $('flamesBtn').textContent = cfg.flames ? 'AN' : 'AUS';
    document.querySelectorAll('#paints .sw').forEach((d, i) => d.classList.toggle('active', i === cfg.paint));
    document.querySelectorAll('#rims .chip').forEach((d, i) => d.classList.toggle('active', i === cfg.rimStyle));
    document.querySelectorAll('#rimColors .sw').forEach((d, i) => d.classList.toggle('active', i === cfg.rimColor));
    document.querySelectorAll('#rimSizes .chip').forEach((d, i) => d.classList.toggle('active', i === cfg.rimSize));
    document.querySelectorAll('#lipColors .chip').forEach((d, i) => d.classList.toggle('active', i === cfg.lipColor));
    $('lettersBtn').textContent = cfg.letters ? 'AN' : 'AUS';
    if (!armed) $('paintName').textContent = E46.PAINTS[cfg.paint].name;
    $('gearbox').textContent = cfg.auto ? 'AUTOMATIK' : 'MANUELL';
    $('soundBtn').textContent = cfg.sound ? 'AN' : 'AUS';
    for (const id of ['volume', 'pVolume']) { $(id).value = cfg.volume; $(id + 'V').textContent = cfg.sound ? cfg.volume + ' %' : 'AUS'; }
    $('smokeBtn').textContent = cfg.smokeOn ? 'AN' : 'AUS';
    $('fxBtn').textContent = cfg.fx === false ? 'AUS' : 'AN';
    document.querySelectorAll('#tods .chip').forEach(d => d.classList.toggle('active', d.dataset.id === (cfg.tod || 'auto')));
    document.querySelectorAll('#finishes .chip').forEach((d, i) => {
      const own = Prog.hasFinish(i), F = Prog.FINISH[i];
      d.classList.toggle('active', i === (cfg.finish | 0)); d.classList.toggle('locked', !own); d.classList.toggle('armed', armed === 'fin:' + i);
      d.innerHTML = E46.FINISHES[i].name + (own ? '' : '<small>' + (Prog.level() < F.lvl ? '🔒 Level ' + F.lvl : (armed === 'fin:' + i ? 'KAUFEN? ' : '') + fmt(F.price) + ' €') + '</small>');
    });
    $('camoRow').classList.toggle('hidden', cfg.model !== 'wheelchair');
    document.querySelectorAll('#camos .chip').forEach((d) => {
      const on = d.dataset.camo === '1', own = Prog.hasCamo(), C = Prog.CAMO;
      d.classList.toggle('active', on === !!cfg.camo); d.classList.toggle('locked', on && !own); d.classList.toggle('armed', on && armed === 'camo');
      d.innerHTML = (on ? '💩 KACKHAUFEN' : 'OHNE') + (on && !own ? '<small>' + (Prog.level() < C.lvl ? '🔒 Level ' + C.lvl : (armed === 'camo' ? 'KAUFEN? ' : '') + fmt(C.price) + ' €') + '</small>' : '');
    });
    $('best').textContent = fmt(rec.best); $('bestCar').textContent = rec.best && rec.bestModel ? carName(rec.bestModel) : '';
    refreshMP();
  }
  const fmt = (n) => Math.round(n).toLocaleString('de-DE');

  // ---------- Chat ----------
  // Drift-Meldungen (geschafft / vermasselt) und getippte Nachrichten aller Spieler
  const CHAT_SHOW = 10000;                      // so lange bleibt eine Nachricht sichtbar (ms), danach nur bei offenem Chat
  function chatAdd(m) {
    const list = $('chatList'); if (!list) return;
    const d = document.createElement('div'); d.className = 'cm ' + (m.kind || 'msg');
    if (m.kind === 'sys') d.textContent = m.text;
    else {
      const n = document.createElement('b'); n.textContent = m.name || 'Spieler'; n.style.color = Net.slotColor(m.slot || 0); d.appendChild(n);
      const t = document.createElement('span');
      t.textContent = m.kind === 'drift' ? ' hat einen Drift geschafft: +' + fmt(m.pts) + ' Punkte'
        : m.kind === 'crash' ? ' hat einen Drift vermasselt: −' + fmt(m.pts) + ' Punkte verloren'
        : m.kind === 'police' ? ' wurde mit dem Moped von der Polizei getaferlt – Kennzeichen weg!'
        : ': ' + m.text;
      d.appendChild(t);
    }
    list.appendChild(d);
    while (list.children.length > 50) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
    if (m.old) d.classList.add('old'); else setTimeout(() => d.classList.add('old'), CHAT_SHOW);
  }
  // eigene Drift-Meldung: online über den Server (kommt als Echo zurück), offline nur lokal
  function chatDrift(kind, pts) {
    pts = Math.round(pts); if (pts <= 0) return;
    if (!Net.sendDriftChat(kind, pts)) chatAdd({ kind, pts, name: myName, slot: Net.slot });
  }
  const chatOpen = () => $('chat').classList.contains('open');
  function openChat() {
    for (const k in keys) keys[k] = false;      // Auto rollt aus, statt mit gedrückter Taste weiterzufahren
    $('chat').classList.add('open');
    const ci = $('chatInput'); ci.value = ''; ci.placeholder = Net.connected ? 'Nachricht … (Enter senden, Esc abbrechen)' : 'Chat nur online – Esc schließt';
    setTimeout(() => ci.focus(), 0);
    const list = $('chatList'); list.scrollTop = list.scrollHeight;
  }
  function closeChat() { $('chat').classList.remove('open'); $('chatInput').blur(); }
  function sendChat() {
    const ci = $('chatInput'), txt = ci.value.trim();
    if (txt && !Net.sendChat(txt)) chatAdd({ kind: 'sys', text: 'Nicht verbunden – Nachrichten gehen nur im Online-Modus.' });
    closeChat();
  }

  // ---------- Eingabe ----------
  const keys = {};
  const touch = {};
  const edge = { up: false, down: false };
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (e.code === 'Enter' && show.on && mode === 'drive') { copShowSkip(); return; }   // Polizei-Film überspringen
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    // T: Chat öffnen (beim Fahren, in der Pause und beim Zuschauen)
    if (e.code === 'KeyT' && (mode === 'drive' || mode === 'pause' || mode === 'spectate')) { e.preventDefault(); openChat(); return; }
    // Y: direkt in die Werkstatthalle – per e.key, damit es auf QWERTZ und QWERTY die Taste mit "Y" ist
    if ((e.key === 'y' || e.key === 'Y') && (mode === 'drive' || mode === 'pause')) { toWorkshop(); return; }
    if (mode === 'drive' || mode === 'pause') {
      if (e.code === 'Escape' || e.code === 'KeyP') setPause(mode !== 'pause');
      if (mode !== 'drive') return;
      if (e.code === 'KeyR') resetCar();
      if (e.code === 'KeyX') backToStart();
      if (e.code === 'KeyC') nextCam();
      if (e.code === 'KeyE') edge.up = true;
      if (e.code === 'KeyQ') edge.down = true;
      if (e.code === 'KeyF') toggleWindow();
      if (e.code === 'KeyG') lightCig();
      if (e.code === 'KeyJ') doShout(null);
    }
    if (mode === 'spectate') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') specSwitch(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') specSwitch(1);
      if (e.code === 'KeyC') specCam();
      if (e.code === 'Escape') enterGarage();
    }
    if (mode === 'drive' && chal.on && chal.phase === 'done' && e.code === 'Enter') { $('chalDone').classList.add('hidden'); restartChallenge(); }
    if (e.code === 'KeyM') { cfg.sound = !cfg.sound; Sound.setMuted(!cfg.sound); save(); refreshUI(); }
    if (mode === 'garage' && e.code === 'Enter') startDrive();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'drive') setPause(true); });

  let padWorkshop = false, padHorn = false, padFlash = false;
  let padPrev = {}, rumbleT = 0, alsT = 0, twoStepPrev = false, dsSeen = 0, blipT = 0;
  const dsQueue = [];
  // ---------- Lenkrad (Logitech G29 / G920 / G923 / G27 …) ----------
  // Lenkachse kommt fast immer als Achse 0. Pedale und Tasten melden die Lenkräder im Browser je nach Modell und
  // System verschieden, darum ein kurzer Assistent im SETUP (Werte landen in localStorage, nicht in cfg/online).
  const WHEEL_RE = /logitech|046d|g29|g920|g923|g27|g25|driving force|momo|thrustmaster|fanatec|wheel|lenkrad/i;
  const wheel = Object.assign({ mode: 'auto', range: 450, steerAx: 0, steerSign: 1, steerC: 0, gasAx: -1, gasRest: 1, gasFull: -1, brkAx: -1, brkRest: 1, brkFull: -1, hbBtn: -1, upBtn: -1, dnBtn: -1, id: '', ffb: 60, ffbInv: false }, load('e46drift.wheel', {}));
  const saveWheel = () => store('e46drift.wheel', wheel);
  let wheelPrev = {}, wheelSeen = '';
  const wiz = { on: false, step: 0, base: null, best: null, held: false };
  function findWheel(pads) {
    if (wheel.mode === 'off') return null;
    for (const p of pads) if (p && (WHEEL_RE.test(p.id) || (wheel.id && p.id === wheel.id))) return p;
    if (wheel.mode === 'on') for (const p of pads) if (p) return p;   // AN: erstes Gerät als Lenkrad behandeln
    return null;
  }
  const wAx = (p, i) => i >= 0 ? (p.axes[i] || 0) : 0;
  const wBtn = (p, i) => i >= 0 && p.buttons[i] ? (p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0)) > 0.5 : false;
  const wPedal = (p, a, rest, full) => a < 0 ? 0 : Math.max(0, Math.min(1, (wAx(p, a) - rest) / ((full - rest) || 1)));
  function wheelSteer(p) {
    const v = (wAx(p, wheel.steerAx) - wheel.steerC) * wheel.steerSign;   // -1..1 über den ganzen Drehbereich (900°)
    return Math.max(-1, Math.min(1, -v * 900 / wheel.range));
  }
  // Lenkrad-Eingaben in die Fahr-Eingabe mischen (Tastatur bleibt nutzbar)
  function wheelInput(p, r) {
    const ws = wheelSteer(p);
    if (Math.abs(ws) > 0.004) r.steer = ws;
    r.thr = Math.max(r.thr, wPedal(p, wheel.gasAx, wheel.gasRest, wheel.gasFull));
    r.brk = Math.max(r.brk, wPedal(p, wheel.brkAx, wheel.brkRest, wheel.brkFull));
    if (wBtn(p, wheel.hbBtn)) r.hb = true;
    const pressed = (i) => wBtn(p, i) && !wheelPrev[i];
    if (pressed(wheel.upBtn)) edge.up = true;
    if (pressed(wheel.dnBtn)) edge.down = true;
    wheelPrev = {}; for (let i = 0; i < p.buttons.length; i++) wheelPrev[i] = wBtn(p, i);
  }
  // Assistent: Lenkachse, Gas, Bremse, Handbremse-Taste, Schaltwippen nacheinander erkennen
  const WIZ = [
    { k: 'steer', t: 'Lenkrad <b>gerade</b> halten, dann ein Stück nach <b>RECHTS</b> drehen.' },
    { k: 'gas', t: '<b>Gaspedal</b> ganz durchtreten und wieder loslassen.' },
    { k: 'brk', t: '<b>Bremspedal</b> ganz durchtreten und wieder loslassen.' },
    { k: 'hb', t: 'Taste für die <b>Handbremse</b> drücken (z. B. eine Taste am Lenkrad).' },
    { k: 'up', t: 'Taste/Wippe zum <b>Hochschalten</b> drücken (gilt bei Schaltgetriebe).' },
    { k: 'dn', t: 'Taste/Wippe zum <b>Runterschalten</b> drücken.' }
  ];
  function wizSnap(p) { return { axes: p.axes.slice(), btn: p.buttons.map((b, i) => wBtn(p, i)) }; }
  function wizShow() {
    $('wheelWiz').classList.toggle('hidden', !wiz.on);
    if (wiz.on) $('wheelWizText').innerHTML = 'Schritt ' + (wiz.step + 1) + ' / ' + WIZ.length + ': ' + WIZ[wiz.step].t;
  }
  function wizNext() {
    wiz.step++; wiz.base = null; wiz.best = null; wiz.held = false;
    if (wiz.step >= WIZ.length) { wiz.on = false; saveWheel(); padToast('🏎 Lenkrad eingerichtet'); }
    wizShow(); refreshWheelUI();
  }
  function wizTick() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = findWheel(pads) || [...pads].find(q => q);
    if (!p) { $('wheelWizText').innerHTML = 'Kein Lenkrad gefunden – bitte anschließen und einmal am Lenkrad drehen.'; return; }
    if (!wiz.base) { wiz.base = wizSnap(p); return; }
    const st = WIZ[wiz.step], B = wiz.base;
    if (st.k === 'steer' || st.k === 'gas' || st.k === 'brk') {
      const used = st.k === 'steer' ? [] : st.k === 'gas' ? [wheel.steerAx] : [wheel.steerAx, wheel.gasAx];
      let bi = -1, bd = 0;
      for (let i = 0; i < p.axes.length; i++) { if (used.includes(i) || (st.k === 'steer' && Math.abs(B.axes[i]) > 0.5)) continue; const d = Math.abs(p.axes[i] - B.axes[i]); if (d > bd) { bd = d; bi = i; } }
      if (st.k === 'steer') {
        if (bd > 0.04) { wheel.id = p.id; wheel.steerAx = bi; wheel.steerC = B.axes[bi]; wheel.steerSign = Math.sign(p.axes[bi] - B.axes[bi]) || 1; wizNext(); }
        return;
      }
      // Pedal: stärkste Auslenkung merken, fertig wenn wieder losgelassen
      if (bd > 0.5 && (!wiz.best || bd > wiz.best.d)) wiz.best = { ax: bi, d: bd, v: p.axes[bi] };
      if (wiz.best && Math.abs(p.axes[wiz.best.ax] - B.axes[wiz.best.ax]) < 0.15) {
        const a = wiz.best.ax;
        if (st.k === 'gas') { wheel.gasAx = a; wheel.gasRest = B.axes[a]; wheel.gasFull = wiz.best.v; }
        else { wheel.brkAx = a; wheel.brkRest = B.axes[a]; wheel.brkFull = wiz.best.v; }
        wizNext();
      }
      return;
    }
    // Tasten: erste neu gedrückte Taste, übernehmen beim Loslassen
    const now = p.buttons.map((b, i) => wBtn(p, i));
    if (wiz.held === false) { const i = now.findIndex((v, j) => v && !B.btn[j]); if (i >= 0) wiz.held = i; return; }
    if (!now[wiz.held]) { wheel[st.k + 'Btn'] = wiz.held; wizNext(); }
  }
  // Anzeige im SETUP: erkanntes Gerät und Live-Werte (zum Prüfen der Einrichtung)
  function refreshWheelUI() {
    if (!$('wheelBtn')) return;
    $('wheelBtn').textContent = { auto: 'AUTO', on: 'AN', off: 'AUS' }[wheel.mode];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = findWheel(pads);
    let txt;
    if (wheel.mode === 'off') txt = 'Lenkrad ausgeschaltet.';
    else if (!p) txt = 'Kein Lenkrad erkannt. Anschließen und einmal drehen oder eine Taste drücken.';
    else {
      const pc = (v) => Math.round(v * 100) + ' %';
      txt = '✅ ' + esc(p.id.slice(0, 48)) + '<br>Lenkung ' + pc(-wheelSteer(p)) + ' · Gas ' + (wheel.gasAx >= 0 ? pc(wPedal(p, wheel.gasAx, wheel.gasRest, wheel.gasFull)) : '–') +
        ' · Bremse ' + (wheel.brkAx >= 0 ? pc(wPedal(p, wheel.brkAx, wheel.brkRest, wheel.brkFull)) : '–') +
        (wheel.gasAx < 0 ? '<br><b>Pedale noch nicht eingerichtet</b> – auf „EINRICHTEN“ klicken.' : '');
    }
    if (window.FFB) {
      txt += '<br>Force Feedback: ' + (FFB.connected ? (FFB.error ? '⚠️ ' : '✅ ') + esc(FFB.name) + ' <small>(' + esc(FFB.diag) + ')</small>' + (FFB.error ? '<br>Fehler: ' + esc(FFB.error) : '') :
        FFB.unsupported ? esc(FFB.unsupported) + ' wird nicht unterstützt (nur G25/G27/G29/G923 PS/DFGT)' :
        !FFB.supported() ? 'geht nur in Chrome/Edge (localhost oder https)' : FFB.error ? esc(FFB.error) : 'nicht verbunden – auf „VERBINDEN“ klicken');
      const fb = FFB.connected ? 'TESTEN' : 'VERBINDEN';
      if ($('ffbBtn').textContent !== fb) $('ffbBtn').textContent = fb;
    }
    if ($('wheelStatus').innerHTML !== txt) $('wheelStatus').innerHTML = txt;
  }
  // ---------- Force Feedback (js/ffb.js, Logitech über WebHID) ----------
  // Rückstellmoment aus dem Schräglauf der Vorderräder: wird mit dem Tempo schwerer und am Grip-Limit leichter,
  // im Drift zieht das Lenkrad von selbst in die Gegenlenk-Richtung. Dazu Dämpfung, Anschlag am Lenkwinkel und Stöße.
  const ffb = { prev: null, joltT: 0, joltA: 0, flip: false, testT: 0 };
  function ffbJolt(a, ms) { if (a > ffb.joltA || ffb.joltT <= 0) ffb.joltA = Math.min(1, a); ffb.joltT = Math.max(ffb.joltT, ms / 1000); }
  // Logitech-Räder reagieren erst ab ca. 7 % Kraft (Totzone) – kleine Kräfte darum darüber heben, sonst spürt man nichts
  function ffbDead(f) {
    const a = Math.min(1, Math.abs(f)), D = 0.07, E = 0.02;
    return Math.sign(f) * (a < E ? D * a / E : D + (1 - D) * (a - E) / (1 - E));
  }
  function ffbFrame(dt, p) {
    if (!window.FFB || !FFB.connected) return;
    // Test geht immer, auch wenn das Lenkrad (noch) nicht über die Gamepad-API sichtbar ist
    if (ffb.testT > 0) {
      ffb.testT -= dt || 1 / 60;
      const t = (ffb.testT > 0.7 ? 1 : -1) * 0.6;                          // erst rechts, dann links
      FFB.set(wheel.ffbInv ? -t : t);
      return;
    }
    const k = wheel.ffb / 100;
    if (!p || wheel.mode === 'off' || k <= 0) { ffb.prev = null; FFB.set(0); return; }
    const pos = (wAx(p, wheel.steerAx) - wheel.steerC) * wheel.steerSign;   // 900°-Bereich, + = rechts
    const vel = ffb.prev == null || dt <= 0 ? 0 : (pos - ffb.prev) / dt; ffb.prev = pos;
    const ps = pos * 900 / wheel.range;                                      // ±1 = eingestellter Lenkwinkel
    let f = 0, lock = 0;
    if (mode === 'drive') {
      const spd = phys.speed, sp = Math.min(1, spd / 10);
      const x = Math.abs(phys.aF || 0) / 0.1, sat = x * Math.exp(1 - x);   // Spitze bei ca. 6° Schräglauf
      f += Math.sign(phys.aF || 0) * sat * 0.8 * sp * (0.6 + 0.4 * Math.min(1, spd / 30)) * (phys.u < 0 ? 0.3 : 1);
      f -= ps * (0.12 + 0.3 * sp);                                           // Rückstellung (auch im Stand etwas)
      f -= vel * (0.06 + 0.12 * (1 - sp));                                   // Dämpfung (im Stand schwerer)
      if (ffb.joltT > 0) { ffb.joltT -= dt; ffb.flip = !ffb.flip; f += (ffb.flip ? 1 : -1) * ffb.joltA * 0.5; }
      if (Math.abs(ps) > 1) lock = -Math.sign(ps) * Math.min(1, (Math.abs(ps) - 1) * 10);   // Anschlag
    } else {
      f -= ps * 0.3 + vel * 0.05;                                            // Garage/Menü: sanfte Zentrierung statt schlaffem Lenkrad
    }
    f = ffbDead(f * k + lock * Math.max(k, 0.6));
    FFB.set(wheel.ffbInv ? -f : f);
  }
  function wheelFrame(dt) {
    if (wiz.on) wizTick();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = findWheel(pads);
    ffbFrame(dt || 0, p);
    if (p && wheelSeen !== p.id) { wheelSeen = p.id; padToast(wheel.gasAx >= 0 ? '🏎 Lenkrad verbunden' : '🏎 Lenkrad erkannt · Pedale im SETUP einrichten'); }
    if (mode === 'garage' && !$('tab-assist').classList.contains('hidden')) refreshWheelUI();
  }
  function readInput() {
    let steer = 0, thr = 0, brk = 0, hb = false;
    if (keys.ArrowLeft || keys.KeyA || touch.left) steer += 1;
    if (keys.ArrowRight || keys.KeyD || touch.right) steer -= 1;
    if (keys.ArrowUp || keys.KeyW || touch.gas) thr = 1;
    if (keys.ArrowDown || keys.KeyS || touch.brake) brk = 1;
    if (keys.Space || touch.hb) hb = true;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const wp = findWheel(pads);
    if (wp) { const r = { steer, thr, brk, hb }; wheelInput(wp, r); steer = r.steer; thr = r.thr; brk = r.brk; hb = r.hb; }
    for (const p of pads) {
      if (!p || p === wp) continue;   // Lenkrad oben schon ausgewertet, hier nur ein normaler Controller
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.3);
      const b = (i) => p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0;
      thr = Math.max(thr, b(7)); brk = Math.max(brk, b(6));
      if (b(0) > 0.5 || b(5) > 0.5 || b(2) > 0.5) hb = true;
      const pressed = (i) => b(i) > 0.5 && !padPrev[i];
      if (pressed(3)) resetCar();
      if (pressed(1)) nextCam();
      if (pressed(9)) setPause(mode !== 'pause');
      if (pressed(8)) backToStart();
      if (pressed(4)) edge.down = true;
      if (pressed(12)) edge.up = true;
      if (pressed(13)) edge.down = true;
      padHorn = b(10) > 0.5; padFlash = (p.axes[3] || 0) < -0.6;   // L3 = Hupe, rechter Stick hoch = Lichthupe
      if (pressed(15)) toggleWindow();   // Steuerkreuz rechts: Fenster
      if (pressed(11)) lightCig();        // rechter Stick drücken: Marlboro
      if (pressed(14)) padWorkshop = true;   // Steuerkreuz links: Werkstatt (nach dem Frame)
      for (let i = 0; i < p.buttons.length; i++) padPrev[i] = b(i) > 0.5;
      break;
    }
    const r = { steer, throttle: thr, brake: brk, handbrake: hb, shiftUp: !cfg.auto && edge.up, shiftDown: !cfg.auto && edge.down };
    edge.up = edge.down = false;
    return r;
  }

  // ---------- Controller in Garage und Pausenmenü ----------
  const padNav = { focus: null, prev: {}, hold: 0, dir: null, connected: false };
  function padItems() {
    const root = !$('chalDone').classList.contains('hidden') ? $('chalDone') : mode === 'pause' ? $('pause') : $('garage');
    return [...root.querySelectorAll('button, .sw, input[type=range]')].filter(el => {
      if (el.disabled || el.closest('.hidden')) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
  }
  function setPadFocus(el) {
    if (padNav.focus) padNav.focus.classList.remove('padfocus');
    padNav.focus = el;
    if (el) { el.classList.add('padfocus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function padMove(dx, dy) {
    const items = padItems(); if (!items.length) return;
    const f = padNav.focus;
    if (!f || !items.includes(f)) { setPadFocus(items[0]); return; }
    // Schieberegler mit links/rechts verstellen
    if (dx && f.type === 'range') {
      const st = parseFloat(f.step) || 1, span = (parseFloat(f.max) - parseFloat(f.min)) || 1;
      const step = Math.max(st, span / 40);
      f.value = Math.max(+f.min, Math.min(+f.max, +f.value + dx * step));
      f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const a = f.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bs = Infinity;
    for (const el of items) {
      if (el === f) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = x * dx + y * dy; if (along <= 4) continue;
      const sc = along + Math.abs(x * dy - y * dx) * 2.5;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) setPadFocus(best);
  }
  function rumble(weak, strong, ms) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    ffbJolt(Math.max(strong, weak * 0.5), ms);
    for (const p of pads) {
      if (!p || !p.vibrationActuator) continue;
      try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }); } catch (e) { /* */ }
      break;
    }
  }
  function padToast(txt) {
    let t = $('padToast');
    if (!t) { t = document.createElement('div'); t.id = 'padToast'; document.body.appendChild(t); }
    t.textContent = txt; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2500);
  }
  function padShowHelp(on) {
    padNav.connected = on;
    const pc = $('padCard'); if (pc) pc.classList.toggle('hidden', !on);
    const kc = document.querySelector('.controls-card:not(.pad-card)'); if (kc) kc.classList.toggle('hidden', on);
  }
  window.addEventListener('gamepadconnected', (e) => { padShowHelp(true); padToast('🎮 Controller verbunden'); rumble(0.4, 0.2, 180); });
  window.addEventListener('gamepaddisconnected', () => {
    const any = [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(p => p);
    if (!any) { padShowHelp(false); setPadFocus(null); padToast('Controller getrennt'); }
  });
  function padMenu(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null; for (const q of pads) if (q) { p = q; break; }
    if (!p) return;
    if (!padNav.connected) padShowHelp(true);
    const b = (i) => p.buttons[i] ? (p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0)) > 0.5 : false;
    const now = {}; for (let i = 0; i < p.buttons.length; i++) now[i] = b(i);
    const pressed = (i) => now[i] && !padNav.prev[i];
    const chalDoneOpen = !$('chalDone').classList.contains('hidden');
    // Zuschauer: LB/RB oder links/rechts = Spieler, A/B = Kamera, Start/Back = Garage
    if (mode === 'spectate') {
      if (pressed(4) || pressed(14)) specSwitch(-1);
      if (pressed(5) || pressed(15)) specSwitch(1);
      if (pressed(0) || pressed(1)) specCam();
      if (pressed(9) || pressed(8)) enterGarage();
      const rx = p.axes[0] || 0;
      if (Math.abs(rx) > 0.6 && !padNav.specStick) { specSwitch(Math.sign(rx)); padNav.specStick = true; } else if (Math.abs(rx) < 0.3) padNav.specStick = false;
      padNav.prev = now; return;
    }
    const inMenu = mode === 'garage' || mode === 'pause' || chalDoneOpen;
    if (inMenu) {
      // Richtung: Steuerkreuz oder linker Stick, mit Wiederholung beim Halten
      const isWheel = p === findWheel(pads);   // Lenkrad: Menü nur über Tasten, Drehen soll nicht durchs Menü springen
      const ax = isWheel ? 0 : p.axes[0] || 0, ay = isWheel ? 0 : p.axes[1] || 0;
      let dx = (now[15] ? 1 : 0) - (now[14] ? 1 : 0), dy = (now[13] ? 1 : 0) - (now[12] ? 1 : 0);
      if (!dx && !dy) { if (Math.abs(ax) > 0.55 && Math.abs(ax) > Math.abs(ay)) dx = Math.sign(ax); else if (Math.abs(ay) > 0.55) dy = Math.sign(ay); }
      const key = dx + ',' + dy;
      if (dx || dy) {
        if (padNav.dir !== key) { padNav.dir = key; padNav.hold = 0.38; padMove(dx, dy); }
        else { padNav.hold -= dt; if (padNav.hold <= 0) { padNav.hold = 0.11; padMove(dx, dy); } }
      } else padNav.dir = null;
      if (pressed(0) && padNav.focus && padItems().includes(padNav.focus) && padNav.focus.type !== 'range') { padNav.focus.click(); rumble(0.15, 0, 40); }
      if (mode === 'garage') {
        // Tabs mit LB / RB
        if (pressed(4) || pressed(5)) {
          const tabs = [...document.querySelectorAll('.tab')], i = tabs.findIndex(t => t.classList.contains('active'));
          const nt = tabs[(i + (pressed(5) ? 1 : -1) + tabs.length) % tabs.length]; nt.click(); setPadFocus(nt);
        }
        if (pressed(9)) { setPadFocus(null); startDrive(); }
        // rechter Stick dreht das Auto
        const rx = isWheel ? 0 : p.axes[2] || 0;
        if (Math.abs(rx) > 0.15) { garageTurn += rx * dt * 2.6; dragVel = 0; }
      } else if (mode === 'pause') {
        if (pressed(1)) { setPadFocus(null); setPause(false); }
        else if (pressed(9) && padNav.prev[9] === false) { setPadFocus(null); setPause(false); }
      }
    } else if (padNav.focus) setPadFocus(null);
    // Wechsel Menü -> Fahren: gedrückte Tasten nicht nochmal als Fahr-Aktion werten
    if (inMenu && mode === 'drive') padPrev = Object.assign({}, now);
    padNav.prev = now;
  }

  // ---------- Challenges über 1 Runde ----------
  // kind 'pts': die meisten Driftpunkte · kind 'time': die schnellste Runde (Zeitrennen)
  const chal = { on: false, kind: 'pts', phase: 'count', t: 0, cd: 0, progress: 0, maxProg: 0, wrongT: 0, goal: 1, lastIdx: -1, lastShown: -1 };
  rec.chal = rec.chal || {};
  rec.lap = rec.lap || {};                         // Bestzeiten pro Strecke: { time, model }
  const fmtTime = (t) => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');
  const fmtLap = (t) => Math.floor(t / 60) + ':' + (t % 60).toFixed(2).padStart(5, '0').replace('.', ',');
  function startChallenge(kind) {
    if (kind === 'time' && track.highway) { popup('KEINE RUNDEN', 'Die Autobahn hört nie auf – probier die Punkte-Challenge', true); return; }
    chal.kind = kind === 'time' ? 'time' : 'pts';
    startDrive();
    restartChallenge();
  }
  function restartChallenge() {
    $('chalDone').classList.add('hidden');
    $('popups').innerHTML = '';                      // Werkstatt-Hinweis o. Ä. nicht über den Countdown legen
    if (score.active) cancelChain();
    placeAtStart();
    for (const k of ['rl', 'rr', 'fl', 'fr']) skids.lift(k);
    skids.clear(); smoke.clear();
    camState.init = false;
    score.total = 0; $('total').textContent = '0'; Net.sendScore(0, 0);
    Object.assign(chal, { on: true, phase: 'count', t: 0, cd: 3.4, progress: 0, maxProg: 0, wrongT: 0, lastIdx: -1, lastShown: -1 });
    fuel = 1; fuelWarn = false;                      // jede Runde mit vollem Tank
    $('chalTitle').textContent = chal.kind === 'time' ? 'ZEITRENNEN · 1 RUNDE' : 'CHALLENGE · 1 RUNDE';
    $('chalHud').classList.remove('hidden');
    updateChalHud();
    refreshMP();
  }
  function updateChalHud() {
    if (chal.kind === 'time') {
      const b = rec.lap[cfg.map];
      $('chalTime').textContent = fmtLap(chal.t);
      // rechts: Abstand zur eigenen Bestzeit (hochgerechnet über den Rundenfortschritt)
      let diff = '';
      if (b && chal.phase === 'run' && chal.progress > 30) { const d = chal.t - b.time * chal.progress / chal.goal; diff = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1).replace('.', ','); }
      $('chalPts').textContent = diff;
      $('chalPts').style.color = diff ? (diff[0] === '+' ? '#ff6b6b' : '#6fe38a') : '';
      $('chalFill').style.width = Math.max(0, Math.min(100, chal.progress / chal.goal * 100)) + '%';
      $('chalRecHud').textContent = b ? 'Bestzeit: ' + fmtLap(b.time) + ' (' + carName(b.model) + ')' : 'Noch keine Bestzeit auf dieser Strecke';
      return;
    }
    $('chalPts').style.color = '';
    const r = rec.chal[cfg.map];
    $('chalTime').textContent = fmtTime(chal.t);
    $('chalPts').textContent = fmt(score.total + (score.active ? score.chain : 0));
    $('chalFill').style.width = Math.max(0, Math.min(100, chal.progress / chal.goal * 100)) + '%';
    $('chalRecHud').textContent = r ? 'Rekord: ' + fmt(r.pts) + ' Pkt (' + fmtTime(r.time) + ', ' + ((window.CAR_MODELS[r.model] || {}).name || r.model) + ')' : 'Noch kein Rekord auf dieser Strecke';
  }
  function updateChallenge(dt) {
    if (chal.phase === 'count') {
      chal.cd -= dt;
      const n = Math.ceil(chal.cd - 0.4);
      if (n !== chal.lastShown && n >= 1 && n <= 3) { chal.lastShown = n; popup(String(n), '', false); Sound.click && Sound.click(); }
      if (chal.cd <= 0.4) {
        chal.phase = 'run'; chal.t = 0; chal.progress = 0;
        chal.lastIdx = phys.trackIdx;
        // Ziel: einmal komplett rum, bis zur Start-/Ziellinie
        const N = track.N, i0 = phys.trackIdx >= 0 ? phys.trackIdx : track.startI - 12;
        chal.goal = N + (((track.startI - i0) % N) + N) % N;
        score.total = 0; cancelChain();
        popup('GO!', chal.kind === 'time' ? 'Die schnellste Runde gewinnt' : 'Die meisten Punkte in einer Runde', false); rumble(0.4, 0.4, 150);
      }
    } else if (chal.phase === 'run') {
      chal.t += dt;
      const idx = phys.trackIdx;
      if (idx >= 0 && chal.lastIdx >= 0) {
        let d = idx - chal.lastIdx; const N = track.N;
        if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
        // Kleine Sprünge (Ruckler, Zurücksetzen mit R auf die Strecke) zählen mit, sonst fehlen am Ende Meter
        // und man kommt nie ins Ziel. Nur große Sprünge (Teleport, Positionsfehler) werden ignoriert.
        if (Math.abs(d) < 150) chal.progress += d;
      }
      if (idx >= 0) chal.lastIdx = idx;
      chal.maxProg = Math.max(chal.maxProg, chal.progress);
      // Falsch herum unterwegs (z. B. nach einem Dreher)? Deutlich warnen, sonst wundert man sich, warum kein Ziel kommt
      chal.wrongT -= dt;
      if (chal.progress < chal.maxProg - 20 && chal.wrongT <= 0) { chal.wrongT = 2.5; popup('FALSCHE RICHTUNG!', 'Umdrehen – die Runde zählt nur vorwärts', true); rumble(0.4, 0.4, 200); }
      if (chal.progress >= chal.goal) finishChallenge();
    }
    updateChalHud();
  }
  function finishChallenge() {
    if (score.active) bankChain();
    chal.phase = 'done';
    if (chal.kind === 'time') { finishLap(); return; }
    $('chalResUnit').textContent = 'PUNKTE';
    const pts = Math.round(score.total), old = rec.chal[cfg.map], isRec = !old || pts > old.pts;
    if (isRec && pts > 0) {
      rec.chal[cfg.map] = { pts, time: chal.t, model: cfg.model };
      store('e46drift.rec', rec);
      cfg.chalRec = Object.assign({}, cfg.chalRec, { [cfg.map]: pts }); cfg.chalRecCar = Object.assign({}, cfg.chalRecCar, { [cfg.map]: cfg.model }); save();   // geht über die Auto-Einstellungen an die anderen
    }
    $('chalResPts').textContent = fmt(pts);
    $('chalResInfo').innerHTML = 'Zeit ' + fmtTime(chal.t) + ' · ' + esc((Track.MAPS[cfg.map] || {}).name || cfg.map) + '<br>' +
      (isRec && pts > 0 ? '<b style="color:var(--yellow)">NEUER REKORD!</b>' + (old ? ' (vorher ' + fmt(old.pts) + ')' : '') : 'Rekord: ' + fmt(old.pts));
    $('chalDone').classList.remove('hidden');
    if (padNav.connected) setPadFocus($('chalAgainBtn'));
    if (isRec && pts > 0) rumble(0.6, 0.6, 400);
    refreshMP();
  }

  // Zeitrennen: Rundenzeit werten, Bestzeit speichern und an die anderen schicken, Platz in der Online-Wertung
  function finishLap() {
    const t = chal.t, mp = cfg.map, old = rec.lap[mp], isRec = !old || t < old.time;
    if (isRec) {
      rec.lap[mp] = { time: t, model: cfg.model };
      store('e46drift.rec', rec);
      cfg.lapRec = Object.assign({}, cfg.lapRec, { [mp]: Math.round(t * 1000) / 1000 }); cfg.lapRecCar = Object.assign({}, cfg.lapRecCar, { [mp]: cfg.model }); save();   // geht über die Auto-Einstellungen an die anderen
    }
    $('chalResPts').textContent = fmtLap(t);
    $('chalResUnit').textContent = 'RUNDENZEIT';
    let info = esc((Track.MAPS[mp] || {}).name || mp) + ' · ' + esc(carName(cfg.model)) + '<br>' +
      (isRec ? '<b style="color:var(--yellow)">NEUE BESTZEIT!</b>' + (old ? ' (vorher ' + fmtLap(old.time) + ', ' + (old.time - t).toFixed(2).replace('.', ',') + ' s schneller)' : '') : 'Bestzeit: ' + fmtLap(old.time) + ' (+' + (t - old.time).toFixed(2).replace('.', ',') + ' s)');
    const board = lapBoard(mp);
    if (board.length > 1) {
      const me = board.findIndex(e => e.me);
      info += '<br>' + (me === 0 ? '🏆 <b style="color:var(--yellow)">PLATZ 1 – du hast die schnellste Runde!</b>' : 'Platz ' + (me + 1) + ' von ' + board.length + ' · Schnellste Runde: ' + esc(board[0].name) + ' ' + fmtLap(board[0].time));
    }
    $('chalResInfo').innerHTML = info;
    $('chalDone').classList.remove('hidden');
    if (padNav.connected) setPadFocus($('chalAgainBtn'));
    if (isRec) rumble(0.6, 0.6, 400);
    if (isRec && Net.connected) chatAdd({ kind: 'sys', text: 'Neue Bestzeit ' + ((Track.MAPS[mp] || {}).name || mp) + ': ' + fmtLap(t) });
    refreshMP();
  }
  // Bestzeiten aller Spieler auf einer Strecke, schnellste zuerst (nur wer schon eine Zeit hat)
  function lapBoard(mp) {
    const out = [];
    const mine = rec.lap[mp]; if (mine) out.push({ me: true, name: myName, slot: Net.slot, time: mine.time, model: mine.model });
    if (Net.connected) for (const r of Net.list()) { const t = (r.lapRec || {})[mp]; if (t) out.push({ me: false, name: r.name, slot: r.slot, time: t, model: (r.lapCar || {})[mp] }); }
    return out.sort((a, b) => a.time - b.time);
  }

  // nur für automatische Tests (#debug in der Adresse)
  if (location.hash.indexOf('debug') >= 0) window.__dbg = { chal, get phys() { return phys; }, get track() { return track; }, get score() { return score; } };

  // ---------- Zuschauermodus ----------
  const spec = { idx: 0, cam: 0, target: null, t: 0, dir: new T.Vector3(1, 0, 0), pos: null, look: null, tvPos: null };
  const SPEC_CAMS = ['VERFOLGER', 'TV', 'HELIKOPTER'];
  function specList() { return [...Net.remotes.values()].filter(r => !r.away && r.snaps.length); }
  function enterSpectate() {
    if (!Net.connected) { $('modeHint').textContent = 'Zuschauen geht nur online: über den Server bzw. Link spielen.'; return; }
    Sound.init(); Sound.setVolume(cfg.volume / 100); Sound.setMuted(!cfg.sound);
    if (Sound.ready) soundUpdate(900, 0, 0, 0, false, false);
    mode = 'spectate';
    Net.sendAway();
    if (car.root.parent) car.root.parent.remove(car.root);      // eigenes Auto nicht auf der Strecke
    $('garage').classList.add('hidden');
    $('hud').classList.remove('hidden'); $('hud').classList.add('spectating');
    $('specHud').classList.remove('hidden');
    spec.pos = null; spec.tvPos = null; spec.target = null;
    refreshMP();
  }
  function specSwitch(d) { const n = specList().length; if (n) { spec.idx = (spec.idx + d + n) % n; spec.pos = null; spec.tvPos = null; } }
  function specCam() { spec.cam = (spec.cam + 1) % SPEC_CAMS.length; spec.pos = null; spec.tvPos = null; popup('KAMERA', SPEC_CAMS[spec.cam], false); }
  function updateSpectate(dt) {
    const list = specList();
    spec.t += dt;
    const r = list.length ? list[spec.idx % list.length] : null;
    spec.target = r;
    // anderer Spieler auf der anderen Strecke: Strecke mitwechseln
    if (r && r.cfg && r.cfg.map && r.cfg.map !== cfg.map && Track.MAPS[r.cfg.map]) { switchMap(r.cfg.map); spec.pos = null; }
    if (!r || !r.cur) {
      // niemand unterwegs: Kameraflug über die Strecke
      const N = track.N, i = Math.floor(spec.t * 6) % N, p = track.S[i], q = track.S[(i + 25) % N];
      camera.position.set(p.x - p.rx * 14, 11 + (p.y || 0), p.z - p.rz * 14); camera.lookAt(q.x, 0.5 + (q.y || 0), q.z);
      camera.fov = 55; camera.updateProjectionMatrix();
      $('specName').textContent = list.length ? 'Warte auf Spieler …' : 'Niemand auf der Strecke';
      $('specInfo').textContent = 'Sobald jemand fährt, schaust du automatisch zu.';
      return;
    }
    const c = r.cur, cy = c.gy || 0, pos = new T.Vector3(c.x, cy, c.z), ck = r.car.cam || { d: 1, h: 1, look: 1 };
    const spd = Math.hypot(c.vx, c.vz);
    const head = new T.Vector3(Math.cos(c.h), 0, -Math.sin(c.h));
    if (spec.cam === 0) {
      const want = head.clone(); if (spd > 2) want.lerp(new T.Vector3(c.vx, 0, c.vz).normalize(), Math.min(1, (spd - 2) / 6) * 0.8).normalize();
      spec.dir.lerp(want, 1 - Math.exp(-dt * 2.2)).normalize();
      const desired = new T.Vector3(c.x - spec.dir.x * 6.8 * ck.d, 2.3 * ck.h + cy, c.z - spec.dir.z * 6.8 * ck.d);
      const look = new T.Vector3(c.x + spec.dir.x * 1.6, 0.9 * ck.look + cy, c.z + spec.dir.z * 1.6);
      if (track.ceilAt && cy < 2) desired.y = Math.min(desired.y, track.ceilAt(desired.x, desired.z) - 0.7, track.ceilAt(c.x, c.z) - 0.7);
      if (!spec.pos) { spec.pos = desired.clone(); spec.look = look.clone(); }
      spec.pos.lerp(desired, 1 - Math.exp(-dt * 6)); spec.look.lerp(look, 1 - Math.exp(-dt * 10));
      camera.position.copy(spec.pos); camera.lookAt(spec.look); camera.fov = 60;
    } else if (spec.cam === 1) {
      if (!spec.tvPos || spec.tvPos.distanceTo(pos) > 55) {
        const i = (track.nearest(c.x, c.z, -1) + 30) % track.N, p = track.S[i], sg = p.k > 0 ? 1 : -1;
        spec.tvPos = new T.Vector3(p.x + p.rx * sg * 16, 3.5 + (p.y || 0), p.z + p.rz * sg * 16);
      }
      camera.position.copy(spec.tvPos); camera.lookAt(c.x, cy + 0.8, c.z);
      camera.fov = T.MathUtils.clamp(2400 / Math.max(10, spec.tvPos.distanceTo(pos)) * 0.5, 14, 55);
    } else {
      const desired = new T.Vector3(c.x - head.x * 6, 34 + cy, c.z - head.z * 6);
      if (!spec.pos) spec.pos = desired.clone();
      spec.pos.lerp(desired, 1 - Math.exp(-dt * 3));
      camera.position.copy(spec.pos); camera.lookAt(c.x, cy, c.z); camera.fov = 50;
    }
    camera.updateProjectionMatrix();
    const M = (window.CAR_MODELS[(r.cfg && r.cfg.model) || 'e46'] || {}).name || '';
    $('specName').innerHTML = '<i style="display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;background:' + Net.slotColor(r.slot) + '"></i>' + esc(r.name) + (list.length > 1 ? ' <small>(' + (spec.idx % list.length + 1) + '/' + list.length + ')</small>' : '');
    $('specInfo').textContent = M + ' · ' + Math.round(spd * 3.6) + ' km/h · Bester Drift ' + fmt(r.best || 0) + ' · Kamera: ' + SPEC_CAMS[spec.cam];
  }

  // ---------- Modi ----------
  function enterGarage() {
    copReset(); smkReset(false); if (car && car.seatNow) car.seatNow();
    Sound.horn && Sound.horn(false); E46.setFlash(car, false);
    mode = 'garage'; $('shout').classList.add('hidden');
    chal.on = false; $('chalHud').classList.add('hidden'); $('chalDone').classList.add('hidden');
    $('specHud').classList.add('hidden'); $('hud').classList.remove('spectating');
    Net.sendAway();
    garageScene.add(car.root);
    E46.setNight(car, 0, 1);
    car.root.position.set(0, 0.08, 0);
    car.root.rotation.set(0, garageTurn, 0);
    car.setBrake(false);
    car.update({ frontSpin: 0, rearSpin: 0, steer: 0.38, roll: 0, pitch: 0 });
    flames.update(0, false);
    $('garage').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('pause').classList.add('hidden');
    refreshUI();
    if (Sound.ready) soundUpdate(900, 0, 0, 0, false, false);
  }
  function startDrive() {
    const fromLift = cameFromLift; cameFromLift = false;
    if (armed) { armed = null; clearTimeout(armT); car.setPaint(E46.PAINTS[cfg.paint].hex); }
    updateProg();
    Sound.init(); Sound.setVolume(cfg.volume / 100); Sound.setMuted(!cfg.sound);
    mode = 'drive';
    driveScene.add(car.root);
    car.root.position.set(0, 0, 0);
    Physics.applyTuning(cfg);
    phys.assist = cfg.assist / 100;
    phys.maxAngle = cfg.maxang * Math.PI / 180;
    phys.auto = cfg.auto;
    placeAtSpawn();
    smoke.clear(); if (!fromLift) skids.clear();
    if (!fromLift) { score.total = 0; Net.sendScore(0, 0); }
    cancelChain(); refreshMP();
    $('total').textContent = fmt(score.total);
    liftReset(); copReset(); smkReset(true);
    $('garage').classList.add('hidden');
    $('hud').classList.remove('hidden');
    camState.init = false;
    showCam();
    if (!fromLift) { if (track.highway) popup('AUTOBAHN', 'Rein in den Verkehr – knapp vorbeidriften gibt Bonus!', false); else popup('WERKSTATT', 'Fahr raus auf die Strecke!', false); }
  }
  function setPause(p) {
    if (mode !== 'drive' && mode !== 'pause') return;
    mode = p ? 'pause' : 'drive';
    $('pause').classList.toggle('hidden', !p);
    if (p && Sound.ready) soundUpdate(phys.rpm, 0, 0, 0, false, false);
    if (p) { Sound.siren && Sound.siren(0, 0); Sound.horn && Sound.horn(false); E46.setFlash(car, false); }
  }
  // eigener Startplatz in der Startaufstellung
  function startSpot() {
    // Reihen im Wechsel zu 3 und 2 Autos, alle 9 m eine Reihe: reicht für 20 Spieler
    const s0 = track.start, sl = Net.slot % 20, rw = Math.floor(sl / 5), k = sl % 5;
    const grid = k < 3 ? [-18 * rw, [0, 4.5, -4.5][k]] : [-18 * rw - 9, k === 3 ? 2.25 : -2.25];
    return { x: s0.x + Math.sin(s0.h) * grid[1] + Math.cos(s0.h) * grid[0], z: s0.z + Math.cos(s0.h) * grid[1] - Math.sin(s0.h) * grid[0], h: s0.h };
  }
  // Spawnplatz in der Werkstatthalle (jeder Spieler hat seinen eigenen)
  function placeAtSpawn() {
    const s = track.spawns[Net.slot % track.spawns.length] || track.spawns[0];
    phys.reset(s.x, s.z, s.h);
    phys.trackIdx = -1; phys._hints = null;
    prevState.x = s.x; prevState.z = s.z; prevState.h = s.h; acc = 0;
  }
  function placeAtStart() {
    const s = startSpot();
    phys.reset(s.x, s.z, s.h);
    phys.trackIdx = -1; phys._hints = null;
    prevState.x = s.x; prevState.z = s.z; prevState.h = s.h; acc = 0;
  }
  // Taste X: zurück an die Startlinie (Gesamtpunkte bleiben)
  function backToStart() {
    if (lift.phase === 'up' || lift.phase === 'fade') return;   // Hebebühne fährt gerade
    if (copActive()) { popup('POLIZEI', 'Davonteleportieren gilt nicht!', true); return; }
    if (chal.on) { restartChallenge(); return; }   // in der Challenge: Runde neu starten
    if (score.active) bankChain();
    placeAtStart();
    for (const k of ['rl', 'rr', 'fl', 'fr']) skids.lift(k);
    cancelChain();
    camState.init = false;
    popup('STARTLINIE', '', false);
  }
  // Taste Y / Steuerkreuz links: direkt in die Werkstatthalle (Gesamtpunkte bleiben, Challenge wird beendet)
  function toWorkshop() {
    if (mode === 'pause') setPause(false);
    if (mode !== 'drive') return;
    if (lift.phase === 'up' || lift.phase === 'fade') return;
    if (copActive()) { popup('POLIZEI', 'Davonteleportieren gilt nicht!', true); return; }
    if (chal.on) { chal.on = false; $('chalHud').classList.add('hidden'); $('chalDone').classList.add('hidden'); }
    if (score.active) bankChain();
    placeAtSpawn();
    for (const k of ['rl', 'rr', 'fl', 'fr']) skids.lift(k);
    cancelChain();
    liftReset();
    camState.init = false;
    popup(track.highway ? 'STANDSTREIFEN' : 'WERKSTATT', '', false);
  }
  const jonnyFall = { gasPrev: false, hinted: false };
  // Admin-Flip: Auto liegt auf dem Dach, bis der Spieler unten rechts "ICH GEBE AUF" drückt
  const flip = { on: false, k: 0 };
  function flipStart() {
    if (flip.on) return;
    flip.on = true;
    $('giveUp').classList.remove('hidden');
    popup('AUF DEM DACH!', 'Unten rechts: ICH GEBE AUF', true);
  }
  function flipGiveUp() {
    if (!flip.on) return;
    flip.on = false;
    $('giveUp').classList.add('hidden');
  }
  $('giveUp').addEventListener('click', flipGiveUp);
  function resetCar() {
    if (lift.phase === 'up' || lift.phase === 'fade') return;   // Hebebühne fährt gerade
    if (flip.on) { popup('AUF DEM DACH', 'Drück unten rechts ICH GEBE AUF', true); return; }
    if (car && car.seatNow) car.seatNow();   // R: Jonny sitzt sofort wieder drin
    if (copActive()) { popup('POLIZEI', 'Davonteleportieren gilt nicht!', true); return; }
    if (track.inPaddock(phys.x, phys.z)) { placeAtSpawn(); cancelChain(); camState.init = false; return; }
    const i = track.nearest(phys.x, phys.z, phys.trackIdx);
    const p = track.S[i];
    phys.reset(p.x, p.z, Math.atan2(-p.tz, p.tx)); phys._hints = null;
    prevState.x = p.x; prevState.z = p.z; prevState.h = phys.h; acc = 0;
    phys.trackIdx = i;
    skids.lift('rl'); skids.lift('rr'); skids.lift('fl'); skids.lift('fr');
    cancelChain();
    camState.init = false;
  }

  // ---------- Punkte ----------
  const score = { total: 0, chain: 0, time: 0, idle: 0, active: false, mult: 1, maxAngle: 0, tandem: 0, tandemWith: '', tandemPts: 0 };
  // Tandem-Drift: ein anderer Spieler driftet dicht neben/vor/hinter mir in dieselbe Richtung -> Multiplikator x10
  const TANDEM_MULT = 10, TANDEM_DIST = 14;
  function tandemPartner() {
    if (!Net.remotes) return null;
    const spd = phys.speed; if (spd < 1) return null;
    const dx = phys.vx / spd, dz = phys.vz / spd;
    let best = null, bd = TANDEM_DIST;
    for (const r of Net.remotes.values()) {
      const c = r.cur; if (!c || ((r.cfg && r.cfg.map) || 'hakone') !== (Net.myMap || 'hakone')) continue;
      if (Math.abs((phys.groundY || 0) - (c.gy || 0)) > 2.5) continue;          // Brücke: einer oben, einer unten
      const rs = Math.hypot(c.vx, c.vz); if (rs < 7 || c.u <= 0) continue;
      if ((c.vx * dx + c.vz * dz) / rs < 0.6) continue;                          // gleiche Fahrtrichtung
      const lat = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h);
      if (Math.abs(Math.atan2(lat, Math.abs(c.u))) * 180 / Math.PI < 10) continue;   // der andere driftet auch
      const d = Math.hypot(c.x - phys.x, c.z - phys.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function cancelChain() { score.smoked = false; score.chain = 0; score.time = 0; score.idle = 0; score.active = false; score.mult = 1; score.tandem = 0; score.tandemPts = 0; $('chain').classList.remove('on', 'tandem-on'); $('tandem').classList.remove('on'); }
  function popup(text, sub, bad) {
    const d = document.createElement('div'); d.className = 'pop' + (bad === 'lvl' ? ' lvl' : bad ? ' bad' : '');
    d.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }
  function bankChain() {
    if (score.chain > 50) {
      let cigBonus = false;
      if (score.smoked && !smk.bonusUsed) { score.chain += CIG_BONUS; smk.bonusUsed = true; cigBonus = true; }   // Raucher-Bonus
      score.total += score.chain;
      const pts = score.chain;
      let lbl = 'GUT!';
      if (pts > 2500) lbl = 'SAUBER!'; if (pts > 7000) lbl = 'SEHR GUT!'; if (pts > 15000) lbl = 'WAHNSINN!'; if (pts > 30000) lbl = 'DRIFT KING!';
      const rw = SHOT ? { money: 0 } : reward(pts);
      if (score.tandemPts > 0) lbl = 'TANDEM ' + lbl;
      popup('+' + fmt(pts), lbl + ' · +' + fmt(rw.money) + ' €' + (cigBonus ? ' · inkl. +' + fmt(CIG_BONUS) + ' MARLBORO' : ''));
      chatDrift('drift', pts);
      if (pts > rec.best) { rec.best = pts; rec.bestModel = cfg.model; store('e46drift.rec', rec); cfg.bestCar = cfg.model; save(); setTimeout(() => popup('NEUER REKORD', fmt(pts)), 500); }
      $('total').textContent = fmt(score.total);
      Net.sendScore(score.total, pts, rec.best, rec.bestModel); refreshMP();
      $('best').textContent = fmt(rec.best); $('bestCar').textContent = rec.bestModel ? carName(rec.bestModel) : '';
    }
    cancelChain();
  }
  // Autobahn: knapp am Verkehr vorbei (clear = Abstand in m). Nur im Drift gibt's Bonuspunkte für die Kette.
  const NEAR_PTS = 350;
  function nearMiss(list) {
    for (const e of list) {
      if (!score.active) continue;
      const k = e.clear < 0.35 ? 3 : e.clear < 0.75 ? 2 : 1;
      const pts = Math.round(NEAR_PTS * k * (e.truck ? 1.5 : 1) * score.mult * Math.max(1, phys.speed * 3.6 / 100));
      score.chain += pts;
      popup(k === 3 ? 'HAARSCHARF!' : k === 2 ? 'KNAPP VORBEI!' : 'VORBEI!', '+' + fmt(pts) + (e.truck ? ' · LKW' : ''), 'lvl');
      rumble(0.2, 0.35, 90);
    }
  }
  function updateScore(dt, hit) {
    const spd = phys.speed;
    const ang = Math.abs(phys.beta) * 180 / Math.PI;
    const drifting = spd > 7 && ang > 10 && phys.u > 0 && !phys.reverse;
    // Nähe zur Mauer (Heck)
    const S = track.S[Math.max(0, phys.trackIdx)];
    const fx = Math.cos(phys.h), fz = -Math.sin(phys.h);
    const rx = phys.x - fx * 2.25, rz = phys.z - fz * 2.25;
    const latR = (rx - S.x) * S.rx + (rz - S.z) * S.rz;
    const near = drifting && Math.abs(latR) > track.WALL - 3.2 && Math.abs(latR) < track.WALL + 0.5 && !track.inPaddock(rx, rz);
    $('proxi').classList.toggle('on', near);

    if (hit > 3.5) {
      Sound.crash(hit); rumble(0.5, Math.min(1, hit * 0.12), 220);
      camState.shake = Math.min(0.6, hit * 0.04);
      if (score.active && score.smoked && !smk.penUsed) {   // beim Rauchen den Drift vermasselt
        smk.penUsed = true; score.total -= CIG_PENALTY; $('total').textContent = fmt(score.total);
        popup('CRASH MIT TSCHICK!', '-' + fmt(score.chain + CIG_PENALTY), true); chatDrift('crash', score.chain + CIG_PENALTY);
        Net.sendScore(score.total, 0);
      } else if (score.active && score.chain > 50) { popup('CRASH!', '-' + fmt(score.chain), true); chatDrift('crash', score.chain); }
      cancelChain();
      return;
    }
    if (drifting) {
      score.active = true; score.idle = 0; score.time += dt;
      if (smk.on) score.smoked = true;
      score.mult = Math.min(5, 1 + Math.floor(score.time / 1.5) * 0.5);
      // Tandem: kurz nachhalten, damit es beim Wechsel der Drift-Richtung nicht flackert
      const partner = tandemPartner();
      if (partner) {
        if (score.tandem <= 0) { popup('TANDEM!', 'mit ' + esc(partner.name) + ' · x' + TANDEM_MULT, 'lvl'); rumble(0.3, 0.5, 120); }
        score.tandem = 0.6; score.tandemWith = partner.name;
      } else score.tandem = Math.max(0, score.tandem - dt);
      const tdm = score.tandem > 0, mult = tdm ? TANDEM_MULT : score.mult;
      const angK = Math.min(ang, 75);
      const gain = dt * angK * (spd * 3.6) * 0.06 * mult * (near ? 2 : 1);
      score.chain += gain; if (tdm) score.tandemPts += gain;
      $('chain').classList.add('on');
    } else if (score.active) {
      score.idle += dt;
      if (score.idle > 1.2) bankChain();
    }
    if (score.active) {
      $('chainPts').textContent = fmt(score.chain);
      const tdm = score.tandem > 0;
      $('chainMult').textContent = tdm ? 'x' + TANDEM_MULT : 'x' + score.mult.toFixed(1);
      $('tandem').classList.toggle('on', tdm); $('chain').classList.toggle('tandem-on', tdm);
      if (tdm) $('tandem').textContent = 'TANDEM x' + TANDEM_MULT + ' · ' + score.tandemWith;
      $('chainAngle').textContent = Math.round(ang) + '°';
      $('angleFill').style.width = Math.min(100, ang / 75 * 100) + '%';
    }
  }

  // Ton aktualisieren – Fehler im Ton dürfen nie das Bild einfrieren
  let soundErr = false;
  function soundUpdate(...a) {
    try { Sound.update(...a); } catch (e) { if (!soundErr) { soundErr = true; console.warn('Sound-Fehler (Spiel läuft weiter):', e); } }
  }
  // ---------- Motorsound der anderen Spieler ----------
  const _ra = new T.Vector3();
  function remoteAudio() {
    if (!Sound.ready || !Sound.updateVoice) return;
    const active = mode === 'drive' || mode === 'spectate';
    const live = new Set();
    if (active) {
      camera.updateMatrixWorld();
      for (const r of Net.remotes.values()) {
        if (!r.cur || !r.snaps.length) continue;
        const s = r.snaps[r.snaps.length - 1];
        const key = Physics.engineOf({ model: (r.cfg && r.cfg.model) || 'e46', engines: (r.cfg && r.cfg.engines) || {} }).key;
        const d = camera.position.distanceTo(_ra.set(r.cur.x, 0.6, r.cur.z));
        const gain = 0.95 / (1 + Math.pow(d / 16, 2));
        _ra.applyMatrix4(camera.matrixWorldInverse);             // Lage relativ zur Kamera -> links/rechts
        const pan = Math.max(-1, Math.min(1, _ra.x / Math.max(4, Math.abs(_ra.x) + Math.abs(_ra.z)))) * 0.85;
        const rpm = s.rp != null ? s.rp : 900 + Math.abs(r.cur.u) * 70;   // ältere Version ohne Drehzahl: schätzen
        live.add(r.id);
        Sound.updateVoice(r.id, key, { rpm, load: s.th || 0, cut: !!s.ct, slip: Math.max(s.sr || 0, (s.sf || 0) * 0.7), gain, pan, horn: !!s.hn });
        // Knalle der anderen nachspielen
        if (s.bg != null) {
          if (r.lastBg == null || s.bg < r.lastBg) r.lastBg = s.bg;
          else if (s.bg > r.lastBg) { const n = Math.min(3, s.bg - r.lastBg); r.lastBg = s.bg; for (let i = 0; i < n; i++) setTimeout(() => Sound.bang(0.55 + Math.random() * 0.45, { gain: gain * 0.9, pan }), i * 70); }
        }
      }
    }
    for (const id of Sound.voiceIds()) if (!live.has(id)) Sound.dropVoice(id);
  }

  // ---------- Kamera ----------
  const CAMS = [
    { name: 'VERFOLGER', d: 6.3, h: 2.15, look: 0.9, fov: 60 },
    { name: 'WEIT', d: 9.5, h: 3.6, look: 0.8, fov: 58 },
    { name: 'MOTORHAUBE', hood: true, fov: 72 },
    { name: 'TV', tv: true, fov: 40 }
  ];
  const camState = { idx: 0, dir: new T.Vector3(1, 0, 0), init: false, shake: 0, labelT: 0 };
  function nextCam() { camState.idx = (camState.idx + 1) % CAMS.length; camState.init = false; showCam(); }
  function showCam() { const l = $('camlabel'); l.textContent = 'KAMERA: ' + CAMS[camState.idx].name; l.classList.add('on'); clearTimeout(camState.lt); camState.lt = setTimeout(() => l.classList.remove('on'), 1400); }
  const tmpV = new T.Vector3(), tmpV2 = new T.Vector3();
  function updateCamera(dt) {
    const c = CAMS[camState.idx];
    const pos = car.root.position;
    const head = tmpV.set(Math.cos(phys.h), 0, -Math.sin(phys.h));
    const spd = phys.speed;
    if (c.hood) {
      const p = car.chassis.localToWorld(car.hoodCam ? car.hoodCam.clone() : new T.Vector3(0.35, 1.28, 0));
      camera.position.copy(p);
      camera.lookAt(p.x + head.x * 10, p.y - 0.4, p.z + head.z * 10);
      camera.fov = c.fov; camera.updateProjectionMatrix();
      return;
    }
    if (c.tv) {
      if (!camState.init || camState.tvPos.distanceTo(pos) > 55) {
        const i = (phys.trackIdx + 30) % track.N, p = track.S[i], sg = p.k > 0 ? 1 : -1;
        camState.tvPos = new T.Vector3(p.x + p.rx * sg * 16, 3.5 + (p.y || 0), p.z + p.rz * sg * 16);
        camState.init = true;
      }
      camera.position.copy(camState.tvPos);
      camera.lookAt(pos.x, pos.y + 0.8, pos.z);
      camera.fov = T.MathUtils.clamp(2400 / Math.max(10, camState.tvPos.distanceTo(pos)) * 0.5, 14, 55); camera.updateProjectionMatrix();
      return;
    }
    // Richtung: im Drift vor allem der (ruhigen) Fahrtrichtung folgen, nicht dem schwingenden Heck
    const want = tmpV2.copy(head);
    if (spd > 2) {
      const vd = new T.Vector3(phys.vx, 0, phys.vz).normalize();
      want.lerp(vd, Math.min(1, (spd - 2) / 6) * 0.8).normalize();
    }
    if (phys.u < -1) want.copy(head);
    if (!camState.init) { camState.dir.copy(want); }
    camState.dir.lerp(want, 1 - Math.exp(-dt * 2.2)).normalize();
    const d = camState.dir;
    const ck = car.cam || { d: 1, h: 1, look: 1 };   // großes Fahrzeug (Traktor): Kamera weiter weg / höher
    const gY = phys.renderY != null ? phys.renderY : (phys.groundY || 0);
    const desired = new T.Vector3(pos.x - d.x * c.d * ck.d, c.h * ck.h + lift.y * 0.5 + gY, pos.z - d.z * c.d * ck.d);   // Hebebühne: Kamera fährt etwas mit
    const lookT = new T.Vector3(pos.x + d.x * 1.6, c.look * ck.look + lift.y * 0.8 + gY, pos.z + d.z * 1.6);
    if (!camState.init) { camState.pos = desired.clone(); camState.look = lookT.clone(); camState.init = true; }
    camState.pos.lerp(desired, 1 - Math.exp(-dt * 7));
    const cl = track.clampCam && track.clampCam(camState.pos.x, camState.pos.z, pos.x, pos.z);
    if (cl) { camState.pos.x = cl.x; camState.pos.z = cl.z; camState.pos.y = Math.min(camState.pos.y, 4.5); }
    camState.look.lerp(lookT, 1 - Math.exp(-dt * 12));
    // unter der Brücke: Kamera bleibt unter der Fahrbahnplatte
    if (track.ceilAt && gY < 2) { const ce = Math.min(track.ceilAt(camState.pos.x, camState.pos.z), track.ceilAt(pos.x, pos.z)); if (camState.pos.y > ce - 0.7) camState.pos.y = ce - 0.7; }
    camera.position.copy(camState.pos);
    // Wackeln nur bei Einschlägen, weich abklingend (kein Zufallszittern pro Frame)
    camState.shake = Math.max(0, camState.shake - dt * 1.2);
    if (camState.shake > 0) {
      const tt = performance.now() / 1000;
      camera.position.x += Math.sin(tt * 37) * camState.shake * 0.5;
      camera.position.y += Math.sin(tt * 29 + 1.3) * camState.shake * 0.4;
    }
    camera.lookAt(camState.look);
    camState.roll = (camState.roll || 0) + (Math.max(-0.04, Math.min(0.04, (phys.r || 0) * 0.02 * Math.min(1, spd / 12))) - (camState.roll || 0)) * (1 - Math.exp(-dt * 4));
    camera.rotateZ(camState.roll);
    camState.fov = (camState.fov || c.fov) + ((c.fov + Math.min(14, spd * 0.22)) - (camState.fov || c.fov)) * (1 - Math.exp(-dt * 2));
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
  }

  // ---------- Tageszeit, Licht und Bildeffekte ----------
  let todShot = null, clockMin = -1, shotSkip = false;
  function updateWorld(dt, x, z, y) {
    y = y || 0;
    const tod = todShot != null ? todShot : Sky.todFor(cfg.tod, Date.now());
    const st = track.setTime(tod);
    // Autobahn: Landschaft nachbauen, Verkehr fahren lassen, knapp vorbei
    if (track.update) {
      const ev = track.update(mode === 'pause' ? 0 : dt, x, z, mode === 'drive' ? phys : null, mode === 'spectate' ? null : phys.h);
      if (mode === 'drive' && ev && ev.near.length) nearMiss(ev.near);
    }
    // Schatten & Licht folgen dem Auto bzw. der Kamera
    track.sun.position.set(x + track.sunDir.x * 70, y + track.sunDir.y * 70, z + track.sunDir.z * 70);
    track.sun.target.position.set(x, y, z);
    track.clouds.rotation.y += dt * 0.004;
    smoke.mat.uniforms.tint.value.copy(st.tint);
    post.bloom = 0.24 + 0.36 * st.lamps; post.threshold = 0.86 - 0.04 * st.lamps;
    const driving = mode === 'drive' || mode === 'pause';
    E46.setNight(car, driving ? st.lamps : 0, st.env);
    for (const r of Net.remotes.values()) if (r.car) E46.setNight(r.car, st.lamps, st.env);
    headSpot.intensity = driving && car.headlights && car.headlights.length ? st.lamps * 0.95 * Math.min(1, (car.glareSize || 0.9) + 0.3) : 0;
    const mn = Math.floor(tod * 60);
    if (mn !== clockMin) { clockMin = mn; $('clock').textContent = (st.el > 6 ? '☀' : st.el > -4 ? (tod < 12 ? '🌅' : '🌇') : '🌙') + ' ' + Sky.clock(tod); }
    return st;
  }
  // Bild ausgeben (mit oder ohne Nachbearbeitung)
  function draw(scene) { if (shotSkip) return; post.render(scene, camera); if (scene === driveScene) renderPip(); }

  // ---------- Fahren ----------
  let acc = 0, smokeAcc = [0, 0], popT = 0, sootAcc = 0, bangChain = false, bigFlame = 0;
  const prevState = { x: 0, z: 0, h: 0 };
  // Map wechseln (Strecke neu aufbauen)
  function switchMap(id) {
    if (!Track.MAPS[id] || (track && track.id === id)) return;
    cfg.map = id; save();
    if (track) track.dispose();
    track = Track.build(driveScene, renderer, id);
    peds = makePeds();
    Net.myMap = id; fuel = 1; miniStatic = null;
    skids.clear(); smoke.clear();
  }
  // Fußgänger am Zebrastreifen (Großer Ring): wer einen erwischt, kassiert die Prämie
  const PED_BOUNTY = 200;
  function makePeds() {
    return window.Peds ? Peds.create(track, {
      onHit(sp) {
        Sound.crash(4 + sp * 0.15); rumble(0.6, 0.6, 250); camState.shake = Math.max(camState.shake || 0, 0.15);
        if (!SHOT) Prog.addMoney(PED_BOUNTY);
        updateProg();
        popup('ERWISCHT! +' + fmt(PED_BOUNTY) + ' €', 'Wer auf der Rennstrecke spaziert …', false);
        chatAdd({ kind: 'sys', text: 'Fußgänger am Zebrastreifen erwischt: +' + fmt(PED_BOUNTY) + ' €' });
      }
    }) : null;
  }
  let cameFromLift = false, fuel = 1, fuelWarn = false, refuelMsg = false;
  // Hebebühne: 'idle' -> 'wait' (Auto steht drauf) -> 'up' (fährt hoch) -> 'fade' (Überblendung) -> Garage
  const lift = { phase: 'idle', t: 0, y: 0, hum: 0, onPrev: false };
  const LIFT_WAIT = 0.7, LIFT_UP = 1.8, LIFT_H = 1.7, LIFT_FADE = 0.45;
  function liftReset() { lift.phase = 'idle'; lift.t = 0; lift.y = 0; if (track) track.setLift(0, 'idle'); $('fade').classList.remove('on'); }
  function updateLift(dt, spd) {
    const on = track.onLift(phys.x, phys.z);
    if (lift.phase === 'idle' || lift.phase === 'wait') {
      if (on && !lift.onPrev && lift.phase === 'idle') popup('HEBEBÜHNE', 'Anhalten zum Umbauen', false);
      lift.onPrev = on;
      if (on && spd < 0.8 && !phys.reverse && !copActive()) {
        if (lift.phase === 'idle') { lift.phase = 'wait'; lift.t = 0; track.setLift(0, 'wait'); }
        lift.t += dt;
        if (lift.t > LIFT_WAIT) { lift.phase = 'up'; lift.t = 0; lift.hum = 0; track.setLift(0, 'up'); if (score.active) bankChain(); popup('HEBEBÜHNE', 'Fährt hoch …', false); }
      } else if (lift.phase === 'wait') { lift.phase = 'idle'; track.setLift(0, 'idle'); }
      return false;
    }
    lift.t += dt;
    if (lift.phase === 'up') {
      const k = Math.min(1, lift.t / LIFT_UP);
      lift.y = LIFT_H * (k * k * (3 - 2 * k));            // weich anfahren und abbremsen
      track.setLift(lift.y, 'up');
      lift.hum -= dt; if (lift.hum <= 0 && k < 0.95) { lift.hum = 0.3; Sound.burst && Sound.burst(0.34, 220 + k * 120, 0.12); }   // Hydraulik-Brummen
      if (k >= 1) { lift.phase = 'fade'; lift.t = 0; $('fade').classList.add('on'); }
    } else if (lift.phase === 'fade' && lift.t > LIFT_FADE) {
      cameFromLift = true; enterGarage();
      setTimeout(() => $('fade').classList.remove('on'), 60);
      return true;
    }
    return false;
  }
  // fährt ein anderer Spieler auf derselben Strecke gerade hoch, bewegt sich die Bühne auch bei mir
  function remoteLift() {
    if (!track || lift.phase === 'up' || lift.phase === 'fade') return;
    let y = 0;
    for (const r of Net.remotes.values()) {
      const sn = r.snaps[r.snaps.length - 1];
      if (sn && sn.ly > 0 && ((r.cfg && r.cfg.map) || 'hakone') === Net.myMap) y = Math.max(y, sn.ly);
    }
    if (y > 0 || lift.remoteY > 0) track.setLift(y, y > 0 ? 'up' : lift.phase === 'wait' ? 'wait' : 'idle');
    lift.remoteY = y;
  }


  // ---------- Fenster runter & Marlboro Rot ----------
  // F: Fahrerfenster auf/zu · G: Zigarette anzünden (nur bei offenem Fenster) · 20 Stück im Packerl
  // Drift geschafft, während geraucht wird: +5.000 (einmal pro Zigarette) · Drift dabei vermasselt: −10.000
  const smk = { win: 0, winT: 0, on: false, t: 0, left: 20, bonusUsed: false, penUsed: false, puffAcc: 0 };
  const CIG_TIME = 18, CIG_BONUS = 5000, CIG_PENALTY = 10000;
  const canSmoke = () => !!(car && car.mouth && car.setCig);               // Autos und Rollstuhl
  const hasWindow = () => canSmoke() && !!car.setWindow && !car.noWindow;
  function smkReset(refill) {
    smk.win = 0; smk.winT = 0; smk.on = false; smk.t = 0; if (refill) smk.left = 20;
    if (car && car.setCig) { car.setWindow && car.setWindow(0); car.setCig(false); car.setSmokeArm && car.setSmokeArm(false); }
    $('cig').classList.add('hidden');
  }
  function toggleWindow() {
    if (canSmoke() && car.noWindow) { lightCig(); return; }   // Rollstuhl: kein Fenster – F holt gleich die Tschick raus
    if (!hasWindow()) { popup('KEIN FENSTER', 'Bei dem Fahrzeug gibt\'s nix zum Runterkurbeln', false); return; }
    smk.winT = smk.winT > 0.5 ? 0 : 1;
    popup(smk.winT ? 'FENSTER RUNTER' : 'FENSTER RAUF', smk.winT && !smk.on ? 'G = Marlboro anzünden' : '', false);
  }
  function lightCig() {
    if (!canSmoke()) { popup('NIX DA', 'Hier kann der Fahrer nicht rauchen', false); return; }
    if (smk.on) { popup('RAUCHST EH SCHON', '', false); return; }
    if (car.noWindow) smk.win = smk.winT = 1;   // Rollstuhl: Arm geht direkt raus
    if (smk.win < 0.6) { popup('ERST FENSTER RUNTER', 'Taste F', true); return; }
    if (smk.left <= 0) { popup('PACKERL LEER', 'In der Garage gibt\'s ein neues', true); return; }
    smk.left--; smk.on = true; smk.t = 0; smk.bonusUsed = false; smk.penUsed = false;
    Sound.click && Sound.click(); setTimeout(() => Sound.burst && Sound.burst(0.25, 900, 0.18, 'bandpass'), 120);   // Feuerzeug
    popup('MARLBORO ROT', 'angezündet · noch ' + smk.left + ' im Packerl', false);
    $('cig').classList.remove('hidden');
  }
  // Jonny (Rollstuhl) schreit alle ~10 s einen Spruch – J: sofort
  const shout = { t: 6, seq: 0, idx: 0, hudT: 0 };
  function doShout(force) {
    if (cfg.model !== 'wheelchair' || !window.Jonny) return;
    const i = force != null ? force : Jonny.pick(), txt = Jonny.LINES[i];
    shout.idx = i; shout.seq = (shout.seq + 1) % 1000; shout.t = Jonny.nextDelay();
    phys.shout = shout.seq * 100 + i;   // geht mit dem Snapshot an die anderen
    if (cfg.sound) Jonny.speak(txt, Math.min(1, cfg.volume / 100));
    const el = $('shout'); el.textContent = txt; el.classList.remove('hidden', 'pop'); void el.offsetWidth; el.classList.add('pop'); shout.hudT = 3.2;
  }
  function updateShout(dt) {
    if (shout.hudT > 0 && (shout.hudT -= dt) <= 0) $('shout').classList.add('hidden');
    if (cfg.model !== 'wheelchair') return;
    if ((shout.t -= dt) <= 0) doShout(null);
    // Klingeln = Jonny ruft „Digidigi …“ (beim Drücken, beim Halten alle 2,5 s)
    const ring = !!(keys.KeyH || padHorn);
    if (ring && window.Jonny && (!shout.ring || (shout.ringT -= dt) <= 0)) { doShout(Jonny.DIGI); shout.ringT = 2.5; }
    shout.ring = ring;
  }

  function updateSmoking(dt) {
    if (!canSmoke()) return;
    if (car.noWindow) smk.win = smk.winT = 1;
    smk.win += Math.max(-dt * 0.8, Math.min(dt * 0.8, smk.winT - smk.win));
    car.setWindow && car.setWindow(smk.win);
    if (!smk.on) return;
    smk.t += dt;
    const cyc = smk.t % 3.2, drag = cyc < 0.7;                 // Zug: Glut wird hell …
    car.setCig(true, drag);
    // Arm: bei offenem Fenster draußen, zum Ziehen an den Mund (weich hin und zurück)
    const toMouth = smk.win < 0.5 ? 1 : (cyc < 0.15 ? cyc / 0.15 : cyc < 0.6 ? 1 : cyc < 0.85 ? 1 - (cyc - 0.6) / 0.25 : 0);
    smk.arm = (smk.arm || 0) + ((toMouth * toMouth * (3 - 2 * toMouth)) - (smk.arm || 0)) * Math.min(1, dt * 12);
    car.setSmokeArm && car.setSmokeArm(true, smk.arm);
    // dünner Rauchfaden von der Glut
    smk.tipAcc = (smk.tipAcc || 0) + dt * 7;
    while (smk.tipAcc >= 1 && car.cigTipWorld) {
      smk.tipAcc -= 1;
      const tp = car.cigTipWorld(), g = 0.86;
      smoke.emit(tp.x, tp.y + 0.01, tp.z, phys.vx * 0.85 + (Math.random() - 0.5) * 0.2, 0.25 + Math.random() * 0.2, phys.vz * 0.85 + (Math.random() - 0.5) * 0.2, 0.04 + Math.random() * 0.03, 0.9 + Math.random() * 0.5, [g, g, g + 0.03]);
    }
    if (cyc > 0.85 && cyc < 1.7 && smk.win > 0.4) {            // … dann Rauch aus dem Fenster
      smk.puffAcc += dt * 26;
      const rx = Math.sin(phys.h), rz = Math.cos(phys.h);
      while (smk.puffAcc >= 1) {
        smk.puffAcc -= 1;
        const p = car.chassis.localToWorld(car.mouth.clone().add(new T.Vector3(0.05, 0.02, -0.5)));
        const j = () => Math.random() - 0.5, g = 0.8 + Math.random() * 0.08;
        smoke.emit(p.x, p.y, p.z, phys.vx * 0.55 - rx * 1.3 + j() * 0.4, 0.35 + Math.random() * 0.3, phys.vz * 0.55 - rz * 1.3 + j() * 0.4,
          0.1 + Math.random() * 0.1, 1.2 + Math.random() * 0.7, [g, g, g + 0.03]);
      }
    }
    $('cigFill').style.width = Math.max(0, 100 - smk.t / CIG_TIME * 100) + '%';
    $('cigLeft').textContent = smk.left + '/20';
    if (smk.t > CIG_TIME) { smk.on = false; car.setCig(false); car.setSmokeArm && car.setSmokeArm(false); $('cig').classList.add('hidden'); popup('TSCHICK AUS', 'Stummel aus dem Fenster', false); }
  }

  // ---------- Polizei: Moped schneller als 45 km/h -> Verfolgung -> Anhalten -> Kennzeichen weg („taferln“) ----------
  const cop = { phase: 'off', t: 0, fast: 0, car: null, x: 0, z: 0, h: 0, v: 0, trail: [], light: null, lamps: null };
  const COP_LIMIT = 45, COP_CHASE = 9;
  const copActive = () => cop.phase === 'chase' || cop.phase === 'stop' || cop.phase === 'talk' || cop.phase === 'show';
  function copBuild() {
    if (cop.car) return cop.car;
    const b = buildPoliceCar();
    cop.car = b.pc; cop.lamps = b.lamps; cop.light = b.light;
    return b.pc;
  }
  // Streifenwagen bauen (eigene Polizei und die Polizei bei den anderen Spielern)
  function buildPoliceCar() {
    const pc = E46.create({ model: 'f31', paint: 0xf3f4f5, rimStyle: 7, rimColor: 0xc9ced4, drop: 0.02, camber: 0, track: 0, plate: 'BP-48113', badge: '320d' });
    pc.setLook(E46.lookFromCfg({ plate: 'BP-48113', tint: 40 })); pc.setWheelOpts({ lip: null });
    // Folierung wie in Österreich: blauer Streifen, roter Zierstreifen, Schriftzug POLIZEI
    const txt = (w, h, str, col) => { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d'); g.fillStyle = col; g.font = 'italic 900 78px "Arial Black", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, 256, 52, 500); return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, side: T.DoubleSide })); };
    const hw = pc.dims.halfW + 0.006;
    for (const sd of [1, -1]) {
      const blue = new T.Mesh(new T.PlaneGeometry(3.1, 0.09), new T.MeshBasicMaterial({ color: 0x1d3f9a, side: T.DoubleSide })); blue.position.set(-0.3, 0.8, sd * hw); pc.chassis.add(blue);
      const red = new T.Mesh(new T.PlaneGeometry(3.1, 0.025), new T.MeshBasicMaterial({ color: 0xd0141e, side: T.DoubleSide })); red.position.set(-0.3, 0.862, sd * hw); pc.chassis.add(red);
      const pz = txt(1.3, 0.24, 'POLIZEI', '#1d3f9a'); pz.position.set(-0.1, 0.55, sd * (hw - 0.005)); if (sd < 0) pz.rotation.y = Math.PI; pc.chassis.add(pz);
    }
    const hood = txt(0.9, 0.17, 'POLIZEI', '#1d3f9a'); hood.rotation.order = 'YXZ'; hood.rotation.set(-Math.PI / 2 + 0.1, Math.PI / 2, 0); hood.position.set(1.5, 0.885, 0); pc.chassis.add(hood);
    // Lichtbalken auf dem Dach
    const bar = new T.Group(); bar.position.set(-0.45, 1.475, 0); pc.chassis.add(bar);
    bar.add(new T.Mesh(new T.BoxGeometry(0.26, 0.05, 1.12), E46.mat.real(0x2b2e33, 0.5, 0.3)));
    const lampL = new T.MeshBasicMaterial({ color: 0x1030ff }), lampR = new T.MeshBasicMaterial({ color: 0x1030ff });
    const l1 = new T.Mesh(new T.BoxGeometry(0.22, 0.07, 0.48), lampL); l1.position.set(0, 0.05, -0.29); bar.add(l1);
    const l2 = new T.Mesh(new T.BoxGeometry(0.22, 0.07, 0.48), lampR); l2.position.set(0, 0.05, 0.29); bar.add(l2);
    const lt = new T.PointLight(0x2a50ff, 0, 14, 1.6); lt.position.set(0, 0.3, 0); bar.add(lt);
    pc.root.traverse(o => { if (o.isMesh) o.castShadow = o.material && o.material.type !== 'ShaderMaterial'; });
    return { pc, lamps: [lampL, lampR], light: lt };
  }
  // Punkt auf der eigenen Spur, d Meter hinter dem Spieler
  function trailBack(d) {
    const tr = cop.trail; let acc = 0;
    for (let i = tr.length - 1; i > 0; i--) {
      const a = tr[i], b = tr[i - 1], l = Math.hypot(a.x - b.x, a.z - b.z);
      if (acc + l >= d) { const f = (d - acc) / l; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }; }
      acc += l;
    }
    return tr.length ? { x: tr[0].x, z: tr[0].z, short: true } : { x: phys.x, z: phys.z, short: true };
  }
  function copReset() {
    if (cop.car && cop.car.root.parent) cop.car.root.parent.remove(cop.car.root);
    cop.phase = 'off'; cop.t = 0; cop.fast = 0; cop.vmax = 0; cop.trail.length = 0;
    Sound.siren && Sound.siren(0, 0);
    if (show.on) { copShowCleanup(); show.on = false; $('fade').classList.remove('on'); camState.init = false; }
  }
  function copStart() {
    const pc = copBuild();
    const p = trailBack(55), q = trailBack(50);
    cop.x = p.x; cop.z = p.z; cop.h = Math.atan2(-(q.z - p.z), q.x - p.x) || phys.h; cop.v = phys.speed;
    if (p.short) { cop.x = phys.x - Math.cos(phys.h) * 45; cop.z = phys.z + Math.sin(phys.h) * 45; cop.h = phys.h; }
    driveScene.add(pc.root);
    cop.phase = 'chase'; cop.t = 0;
    popup('POLIZEI!', 'Mit dem Moped über ' + COP_LIMIT + ' km/h …', true);
  }
  // Polizeiauto zu einem Zielpunkt bewegen (weich), Ausrichtung entlang der Bewegung oder fest vorgegeben
  function copMoveTo(tx, tz, dt, k, hFix) {
    const ox = cop.x, oz = cop.z;
    cop.x += (tx - cop.x) * Math.min(1, dt * k); cop.z += (tz - cop.z) * Math.min(1, dt * k);
    const dx = cop.x - ox, dz = cop.z - oz, step = Math.hypot(dx, dz);
    cop.v = step / Math.max(1e-4, dt);
    let ht = hFix != null ? hFix : (step > 0.02 ? Math.atan2(-dz, dx) : cop.h);
    let dh = ht - cop.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    cop.h += dh * Math.min(1, dt * 5);
    return Math.hypot(tx - cop.x, tz - cop.z);
  }
  // ---------- Polizei-Film beim Moped ----------
  // Polizist steigt aus, holt den Rollenprüfstand aus dem Kofferraum, schiebt das Moped auf die Walze,
  // gibt Vollgas (Anzeige klettert weit über 45), nimmt das Taferl ab, Schnitt -> Polizei fährt weg.
  // Enter überspringt.
  const show = { on: false, steps: [], i: 0, t: 0, fig: null, dyno: null, wb: 0, moped: { x: 0, z: 0, y: 0 }, rpm: 0, thr: 0, spin: 0, plateDone: false,
    camPos: new T.Vector3(), camLook: new T.Vector3(), camInit: false, smokeAcc: 0, ctx: null };
  const ease = (k) => k * k * (3 - 2 * k), clamp01 = (k) => Math.max(0, Math.min(1, k));
  function copShowStart() {
    const D = car.dims, wb = D.AXF - D.AXR, R = D.WHEEL_R, XRm = D.XR || -0.86;
    if (!show.fig) {
      show.fig = CopShow.buildCop();
      const pose0 = show.fig.pose;   // letzte Pose merken, sie geht an die anderen Spieler
      show.fig.pose = (dt, p) => { show.fig.netPose = p; pose0(dt, p); };
    }
    if (!show.dyno || show.wb !== wb) { if (show.dyno && show.dyno.root.parent) show.dyno.root.parent.remove(show.dyno.root); show.dyno = CopShow.buildDyno(wb, R); show.wb = wb; }
    const fig = show.fig, dyno = show.dyno;
    if (!dyno.netWrapped) { const d0 = dyno.display; dyno.display = (v, st) => { dyno.netDs = [v, st]; d0(v, st); }; dyno.netWrapped = true; }
    const hc = cop.h, fC = { x: Math.cos(hc), z: -Math.sin(hc) }, rC = { x: Math.sin(hc), z: Math.cos(hc) };
    const h = phys.h, f = { x: Math.cos(h), z: -Math.sin(h) }, r = { x: Math.sin(h), z: Math.cos(h) };
    const P = (o, a, k, b, l) => ({ x: o.x + a.x * k + (b ? b.x * l : 0), z: o.z + a.z * k + (b ? b.z * l : 0) });
    const C = { x: cop.x, z: cop.z }, M = { x: phys.x, z: phys.z };
    // Prüfstand hinter dem Moped (Rampe endet 0,3 m hinter dem Hinterrad), Moped wird rückwärts hinaufgeschoben
    const Xf = wb + 0.36 + 0.62;
    const D0 = P(M, f, D.AXR - R - 0.3 - Xf), Mp = P(D0, f, -D.AXR);
    const xrC = (cop.car.dims && cop.car.dims.XR) || -2.4;
    const door = P(C, fC, 0.35, rC, -1.25), trunk = P(C, fC, xrC - 0.65);
    const place = P(D0, f, wb * 0.45, r, -0.9);
    const barOff = (o) => P(o, f, D.AXF * 0.5, r, -0.6);
    const plateSpot = P(Mp, f, XRm - 0.6), behindL = P(Mp, f, XRm - 0.35, r, -1.0);
    const ctx = show.ctx = { f, r, M, Mp, D0, C, h, plateY: 0.7, XRm };
    const faceDir = (d) => { fig.root.rotation.y = Math.atan2(d.x, d.z); };
    const at = (p) => fig.root.position.set(p.x, 0, p.z);
    const carryDyno = () => {   // Prüfstand quer vor dem Bauch tragen
      const yaw = fig.root.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw);
      dyno.root.rotation.y = yaw;   // Längsachse (+X des Prüfstands) zeigt dann zur Seite
      const lx = Math.cos(yaw), lz = -Math.sin(yaw);
      dyno.root.position.set(fig.root.position.x + fx * 0.55 - lx * wb * 0.5, 0.45, fig.root.position.z + fz * 0.55 - lz * wb * 0.5);
    };
    // Gehen entlang mehrerer Punkte
    const walk = (pts, speed, opt) => {
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      return Object.assign({ dur: Math.max(0.3, len / speed), run(k, dt) {
        let d = k * len;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
          if (d <= l || i === pts.length - 1) { const q = l ? Math.min(1, d / l) : 1; at({ x: a.x + (b.x - a.x) * q, z: a.z + (b.z - a.z) * q }); if (l > 0.01) faceDir({ x: b.x - a.x, z: b.z - a.z }); break; }
          d -= l;
        }
        fig.pose(dt, { walk: speed, carry: opt && opt.carry ? 1 : 0 });
        if (opt && opt.carry) carryDyno();
      } }, opt || {});
    };
    const lerpP = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
    const steps = [
      { dur: 1.0, cam: 'wide', start() { at(door); faceDir({ x: -rC.x, z: -rC.z }); fig.root.visible = true; dyno.root.visible = false; popup('AMTSHANDLUNG', 'Der Inspektor steigt aus …', false); },
        run(k, dt) { fig.pose(dt, {}); } },
      walk([door, P(door, fC, xrC + 0.2), trunk], 2.0, { cam: 'follow' }),
      { dur: 0.9, cam: 'follow', start() { faceDir(fC); }, run(k, dt) {
        fig.pose(dt, { bend: Math.sin(k * Math.PI), carry: k > 0.55 ? 1 : 0 });
        if (k > 0.55) { dyno.root.visible = true; carryDyno(); }
      } },
      walk([trunk, P(M, f, 1.2, r, -1.6), P(M, f, D.AXR - 0.6, r, -1.6), place], 1.5, { carry: true, cam: 'follow', start() { popup('ROLLENPRÜFSTAND', 'Schau ma amal, wie schnell des Moped wirklich is …', false); } }),
      { dur: 0.9, cam: 'follow', start() { faceDir(r); }, run(k, dt) {
        fig.pose(dt, { bend: Math.sin(k * Math.PI), carry: k < 0.5 ? 1 : 0 });
        if (k < 0.5) carryDyno(); else { dyno.root.position.set(D0.x, 0, D0.z); dyno.root.rotation.y = h; }
      } },
      walk([place, P(M, f, 0, r, -1.0), barOff(M)], 1.8, { cam: 'side' }),
      { dur: 2.6, cam: 'side', start() { faceDir(r); popup('AUF DIE WALZE!', '', false); }, run(k, dt) {
        const q = ease(k), p = lerpP(M, Mp, q);
        show.moped.x = p.x; show.moped.z = p.z; show.moped.y = dyno.lift * ease(clamp01((k - 0.45) / 0.4));
        at(barOff(p)); fig.pose(dt, { walk: k < 0.95 ? 0.9 : 0, reach: 1 });
        show.spin = -q * 0.6;
      } },
      { dur: 6.2, cam: 'dyno', start() { show.kmhEnd = Math.round(Math.max(cop.vmax || 0, 58) + 3 + Math.random() * 6); popup('VOLLGAS!', 'Der Inspektor dreht auf …', false); },
        run(k, dt) {
          fig.pose(dt, { reach: 1 });
          const P0 = Physics.P, up = ease(clamp01(k / 0.72));
          show.rpm = P0.idle + (P0.redline - P0.idle) * (0.25 + 0.75 * up) - (k > 0.72 ? Math.random() * 500 : 0);   // oben am Begrenzer
          show.thr = 1;
          const kmh = show.kmhEnd * up + (k > 0.1 ? (Math.random() - 0.5) * 1.5 : 0);
          show.kmh = Math.max(0, kmh); show.spin = show.kmh / 3.6 / car.dims.WHEEL_R;
          dyno.display(show.kmh, k > 0.78 ? 'bad' : 'run');
          for (const rl of dyno.rollers) rl.rotation.z -= show.kmh / 3.6 / dyno.RR * dt;
          camState.shake = Math.max(camState.shake || 0, 0.02 + up * 0.05);
          if (k > 0.78 && !show.bigPop) { show.bigPop = true; popup('PRÜFSTAND: ' + show.kmhEnd + ' km/h', 'Erlaubt sind 45 – das Moped ist frisiert!', true); rumble(0.7, 0.7, 500); }
          if (Math.random() < dt * 3) rumble(0.15, 0.3 * up, 80);
          showSmoke(dt, up);
        } },
      { dur: 1.0, cam: 'dyno', run(k, dt) {
        fig.pose(dt, { reach: 1 - k });
        show.rpm = Physics.P.idle + (show.rpm - Physics.P.idle) * Math.max(0, 1 - dt * 3); show.thr = 0;
        show.spin *= Math.max(0, 1 - dt * 2.5); for (const rl of dyno.rollers) rl.rotation.z -= show.spin * car.dims.WHEEL_R / dyno.RR * dt;
        dyno.display(show.kmhEnd, 'bad'); showSmoke(dt, 0.3 * (1 - k));
      } },
      walk([barOff(Mp), behindL, plateSpot], 1.9, { cam: 'plate', start() { show.rpm = 0; } }),
      { dur: 1.4, cam: 'plate', start() { faceDir(f); }, run(k, dt) {
        fig.pose(dt, { reach: Math.sin(clamp01(k / 0.8) * Math.PI) * 0.8, bend: 0.25 * Math.sin(k * Math.PI) });
        if (k > 0.45) takePlate();
      } },
      { dur: 1.6, cam: 'plateWide', start() { faceDir({ x: -f.x, z: -f.z }); }, run(k, dt) { fig.pose(dt, { wave: true }); } },
      // Schnitt: Abblende, aufräumen, Polizei fährt davon
      { dur: 1.3, cam: 'plateWide', start() { $('fade').classList.add('on'); }, run(k, dt) {
        fig.pose(dt, { wave: true });
        if (k > 0.4 && !show.cleaned) { show.cleaned = true; copShowCleanup(); }
        if (k > 0.55) $('fade').classList.remove('on');
      } }
    ];
    if (!fig.root.parent) driveScene.add(fig.root);
    if (!dyno.root.parent) driveScene.add(dyno.root);
    fig.plate.visible = false; dyno.display(0, 'ready'); dyno.root.visible = false;
    Object.assign(show, { on: true, steps, i: 0, t: 0, rpm: 0, thr: 0, spin: 0, kmh: 0, plateDone: false, cleaned: false, bigPop: false, camInit: false, moped: { x: M.x, z: M.z, y: 0 } });
    if (steps[0].start) steps[0].start();
  }
  function takePlate() {
    if (show.plateDone) return; show.plateDone = true;
    if (car.setPlateOff) car.setPlateOff(true);
    if (show.fig) show.fig.plate.visible = true;
    Sound.click && Sound.click(); rumble(0.5, 0.5, 250);
    popup('GETAFERLT!', 'Kennzeichen abgenommen – 45 km/h heißt 45!', true);
    chatDrift('police', 1);
  }
  function showSmoke(dt, k) {
    if (k <= 0.02 || !show.ctx) return;
    const c = show.ctx, D = car.dims;
    show.smokeAcc += dt * (4 + 18 * k);
    while (show.smokeAcc >= 1) {
      show.smokeAcc -= 1;
      const j = () => Math.random() - 0.5;
      if (Math.random() < 0.55) {   // Reifenqualm an der Walze
        const wx = show.moped.x + c.f.x * D.AXR, wz = show.moped.z + c.f.z * D.AXR;
        smoke.emit(wx + j() * 0.3, 0.2 + Math.random() * 0.15, wz + j() * 0.3, -c.f.x * 2.5 + j() * 1.5, 0.6 + Math.random(), -c.f.z * 2.5 + j() * 1.5, 0.5 + Math.random() * 0.4, 1.6 + Math.random() * 1.2, E46.smokeRGB(cfg));
      } else {                      // blauer Zweitaktqualm aus dem Auspuff
        const wp = car.chassis.localToWorld(car.exhaust[0].clone()), g = 0.68 + Math.random() * 0.12;
        smoke.emit(wp.x, wp.y, wp.z, -c.f.x * 3 + j() * 0.6, 0.4 + Math.random() * 0.5, -c.f.z * 3 + j() * 0.6, 0.18 + Math.random() * 0.15, 1.3 + Math.random(), [g * 0.9, g * 0.95, g + 0.08]);
      }
    }
  }
  // alles wegräumen (am Ende des Films oder beim Überspringen)
  function copShowCleanup() {
    takePlate();
    if (show.fig) { show.fig.root.visible = false; show.fig.plate.visible = false; }
    if (show.dyno) show.dyno.root.visible = false;
    if (show.ctx) { show.moped.x = show.ctx.M.x; show.moped.z = show.ctx.M.z; }
    show.moped.y = 0; show.rpm = 0; show.thr = 0; show.spin = 0;
  }
  function copShowEnd() {
    copShowCleanup();
    $('fade').classList.remove('on');
    show.on = false; camState.init = false;
    cop.phase = 'leave'; cop.t = 0;
  }
  function copShowSkip() {
    if (!show.on) return;
    const last = show.steps.length - 1;
    if (show.i >= last) return;
    show.i = last; show.t = 0; show.steps[last].start();
  }
  function copShowUpdate(dt) {
    const st = show.steps[show.i];
    show.t += dt;
    const k = clamp01(show.t / st.dur);
    st.run(k, dt);
    if (show.t >= st.dur) {
      show.i++; show.t = 0;
      if (show.i >= show.steps.length) { copShowEnd(); return; }
      const nx = show.steps[show.i]; if (nx.start) nx.start();
    }
  }
  // Filmkamera: je Abschnitt eine eigene Einstellung, weich überblendet
  function copShowCam(dt) {
    if (!show.on || !show.ctx) return false;
    const c = show.ctx, st = show.steps[Math.min(show.i, show.steps.length - 1)], fp = show.fig.root.position;
    const f = c.f, r = c.r, pos = cshV1.set(0, 0, 0), look = cshV2.set(0, 0, 0);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    switch (st.cam) {
      case 'wide': { const m = mid(c.M, c.C); pos.set(c.M.x + r.x * 6.5 + f.x * 1.5, 2.0, c.M.z + r.z * 6.5 + f.z * 1.5); look.set(m.x, 0.9, m.z); break; }
      case 'follow': pos.set(fp.x + r.x * 4.6 - f.x * 1.2, 2.5, fp.z + r.z * 4.6 - f.z * 1.2); look.set(fp.x, 0.9, fp.z); break;
      case 'side': { const m = mid(c.M, c.Mp); pos.set(m.x + r.x * 4.0 + f.x * 0.4, 1.25, m.z + r.z * 4.0 + f.z * 0.4); look.set(m.x, 0.55, m.z); break; }
      case 'dyno': {
        // von vorne rechts langsam zur Seite schwenken (der Qualm zieht nach hinten weg)
        const a0 = Math.atan2(r.z * 0.8 + f.z, r.x * 0.8 + f.x) + show.t * 0.12, rad = 3.6 - Math.min(0.6, show.t * 0.1);
        pos.set(c.Mp.x + Math.cos(a0) * rad, 0.75, c.Mp.z + Math.sin(a0) * rad); look.set(c.Mp.x - f.x * 0.3, 0.65, c.Mp.z - f.z * 0.3); break;
      }
      case 'plate': pos.set(c.Mp.x + f.x * (c.XRm - 0.5) + r.x * 2.2, 1.05, c.Mp.z + f.z * (c.XRm - 0.5) + r.z * 2.2); look.set(c.Mp.x + f.x * c.XRm, c.plateY + show.moped.y, c.Mp.z + f.z * c.XRm); break;
      default: pos.set(c.Mp.x - f.x * 4.6 + r.x * 2.6, 1.6, c.Mp.z - f.z * 4.6 + r.z * 2.6); look.set(fp.x, 1.2, fp.z);
    }
    if (!show.camInit) { show.camPos.copy(pos); show.camLook.copy(look); show.camInit = true; }
    const q = 1 - Math.exp(-dt * 2.6);
    show.camPos.lerp(pos, q); show.camLook.lerp(look, q);
    const sh = camState.shake || 0; camState.shake = Math.max(0, sh - dt * 0.5);
    camera.position.set(show.camPos.x + (Math.random() - 0.5) * sh, show.camPos.y + (Math.random() - 0.5) * sh, show.camPos.z + (Math.random() - 0.5) * sh);
    camera.lookAt(show.camLook);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    return true;
  }
  const cshV1 = new T.Vector3(), cshV2 = new T.Vector3();

  // ---------- Polizei & Polizei-Film bei den anderen Spielern ----------
  // Wer verfolgt bzw. getaferlt wird, schickt den Polizei-Zustand mit seinem Schnappschuss (cp).
  // Bei allen anderen stehen Streifenwagen, Polizist und Prüfstand dann an derselben Stelle,
  // und der Film läuft zusätzlich live in einem kleinen Fenster unten links.
  const PHASE_CODE = { chase: 'c', stop: 's', talk: 't', show: 'w', leave: 'l' }, DS_CODE = { ready: 0, run: 1, bad: 2 }, DS_NAME = ['ready', 'run', 'bad'];
  function copNetState() {
    if (cop.phase === 'off' || !cop.car) return 0;
    const q = (v) => Math.round(v * 100) / 100;
    const o = { p: PHASE_CODE[cop.phase] || 'c', x: q(cop.x), z: q(cop.z), h: q(cop.h), v: q(cop.v || 0), lo: (cop.phase !== 'leave' || cop.t < 2) ? 1 : 0 };
    if (show.on && show.fig) {
      const f = show.fig, d = show.dyno, np = f.netPose || {};
      if (f.root.visible) o.f = [q(f.root.position.x), q(f.root.position.z), q(f.root.rotation.y), q(np.walk || 0), q(np.carry || 0), q(np.bend || 0), q(np.reach || 0), np.wave ? 1 : 0, f.plate.visible ? 1 : 0];
      if (d && d.root.visible) o.d = [q(d.root.position.x), q(d.root.position.y), q(d.root.position.z), q(d.root.rotation.y)];
      if (d && d.netDs) o.ds = [Math.round(d.netDs[0]), DS_CODE[d.netDs[1]] || 0];
      o.m = [q(show.moped.x), q(show.moped.y), q(show.moped.z)];
      o.sp = q(show.spin || 0); o.k = Math.round(show.kmh || 0);
      o.cam = [q(camera.position.x), q(camera.position.y), q(camera.position.z), q(show.camLook.x), q(show.camLook.y), q(show.camLook.z)];
    }
    return o;
  }
  function netUpdate(dt) { Net.update(dt); updateRemoteCops(dt); }
  const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
  const rcops = new Map();
  let rcSiren = false;
  function rcHide(rc) { for (const o of [rc.pc, rc.fig, rc.dyno]) if (o) o.root.visible = false; }
  function rcDispose(rc) { for (const o of [rc.pc, rc.fig, rc.dyno]) if (o && o.root.parent) o.root.parent.remove(o.root); }
  function updateRemoteCops(dt) {
    for (const [id, rc] of rcops) if (!Net.remotes.has(id)) { rcDispose(rc); rcops.delete(id); }
    let pipCand = null, sir = 0, sirPan = 0;
    const k = 1 - Math.exp(-dt * 10);
    for (const r of Net.remotes.values()) {
      const b = r.snaps.length && !r.away ? r.snaps[r.snaps.length - 1] : null, cp = b ? b.cp : 0;
      let rc = rcops.get(r.id);
      if (!cp) { if (rc) { rcHide(rc); rc.announced = false; } continue; }
      if (!rc) { rc = {}; rcops.set(r.id, rc); }
      const sameMap = ((r.cfg && r.cfg.map) || 'hakone') === (Net.myMap || 'hakone');
      if (cp.p === 'c') rc.announced = false;
      if (cp.p === 'w' && !rc.announced) {
        rc.announced = true;
        if (mode === 'drive' || mode === 'spectate') popup('🚓 ' + esc(r.name).toUpperCase() + ' WIRD GETAFERLT!', sameMap ? 'Live-Übertragung unten links' : 'auf der anderen Strecke', true);
      }
      if (!sameMap || !r.car.root.visible) { rcHide(rc); continue; }
      // Streifenwagen
      if (!rc.pc) { const pb = buildPoliceCar(); rc.pc = pb.pc; rc.lamps = pb.lamps; rc.light = pb.light; driveScene.add(rc.pc.root); rc.x = cp.x; rc.z = cp.z; rc.h = cp.h; }
      rc.pc.root.visible = true;
      rc.x += (cp.x - rc.x) * k; rc.z += (cp.z - rc.z) * k; rc.h = lerpAng(rc.h, cp.h, k);
      rc.pc.root.position.set(rc.x, 0, rc.z); rc.pc.root.rotation.y = rc.h;
      const PR = rc.pc.dims.WHEEL_R;
      rc.pc.update({ frontSpin: (cp.v || 0) / PR * dt, rearSpin: (cp.v || 0) / PR * dt, steer: 0, roll: 0, pitch: 0 });
      rc.pc.setBrake(cp.p === 's' || cp.p === 't' || cp.p === 'w');
      const fl = (performance.now() / 1000 * 4) % 2 < 1, on = !!cp.lo;
      rc.lamps[0].color.setHex(on && fl ? 0x4f74ff : 0x0a1440); rc.lamps[1].color.setHex(on && !fl ? 0x4f74ff : 0x0a1440);
      rc.light.intensity = on ? (fl ? 2.2 : 1.2) : 0;
      if (cp.p === 'c' || cp.p === 's') {   // Martinshorn der fremden Polizei (lauter je näher)
        const dd = Math.hypot(rc.x - phys.x, rc.z - phys.z), v = 1 / (1 + Math.pow(dd / 30, 2));
        if (v > sir) { sir = v; camera.updateMatrixWorld(); const rel = new T.Vector3(rc.x, 1, rc.z).applyMatrix4(camera.matrixWorldInverse); sirPan = rel.x / Math.max(4, Math.abs(rel.x) + Math.abs(rel.z)) * 0.8; }
      }
      // Film: Polizist, Prüfstand, Moped auf der Walze
      if (cp.p !== 'w') { if (rc.fig) rc.fig.root.visible = false; if (rc.dyno) rc.dyno.root.visible = false; continue; }
      if (!rc.fig) { rc.fig = CopShow.buildCop(); driveScene.add(rc.fig.root); }
      if (cp.f) {
        const F = cp.f, fr = rc.fig.root;
        if (!fr.visible) fr.position.set(F[0], 0, F[1]);
        fr.visible = true;
        fr.position.x += (F[0] - fr.position.x) * k; fr.position.z += (F[1] - fr.position.z) * k; fr.rotation.y = lerpAng(fr.rotation.y, F[2], k);
        rc.fig.pose(dt, { walk: F[3], carry: F[4], bend: F[5], reach: F[6], wave: !!F[7] });
        rc.fig.plate.visible = !!F[8];
      } else rc.fig.root.visible = false;
      const D = r.car.dims, wb = D.AXF - D.AXR;
      if (cp.d) {
        if (!rc.dyno || rc.wb !== wb) { if (rc.dyno && rc.dyno.root.parent) rc.dyno.root.parent.remove(rc.dyno.root); rc.dyno = CopShow.buildDyno(wb, D.WHEEL_R); rc.wb = wb; driveScene.add(rc.dyno.root); rc.dyno.root.visible = false; }
        const dr = rc.dyno.root, Dd = cp.d;
        if (!dr.visible) { dr.position.set(Dd[0], Dd[1], Dd[2]); dr.rotation.y = Dd[3]; }
        dr.visible = true;
        dr.position.x += (Dd[0] - dr.position.x) * k; dr.position.y += (Dd[1] - dr.position.y) * k; dr.position.z += (Dd[2] - dr.position.z) * k; dr.rotation.y = lerpAng(dr.rotation.y, Dd[3], k);
        if (cp.ds) { rc.dyno.display(cp.ds[0], DS_NAME[cp.ds[1]] || 'ready'); if (cp.ds[1] && cp.sp > 1) for (const rl of rc.dyno.rollers) rl.rotation.z -= cp.sp * D.WHEEL_R / rc.dyno.RR * dt; }
      } else if (rc.dyno) rc.dyno.root.visible = false;
      if (cp.m) {
        if (!rc.m) rc.m = { x: cp.m[0], y: cp.m[1], z: cp.m[2] };
        rc.m.x += (cp.m[0] - rc.m.x) * k; rc.m.y += (cp.m[1] - rc.m.y) * k; rc.m.z += (cp.m[2] - rc.m.z) * k;
        r.car.root.position.set(rc.m.x, rc.m.y, rc.m.z);
      }
      if (cp.sp) r.car.update({ frontSpin: 0, rearSpin: cp.sp * dt, steer: 0, roll: 0, pitch: 0, throttle: b.th || 0, speed: 0, beta: 0 });
      // Qualm an der Walze
      if (cp.k > 5 && cp.ds && cp.ds[1]) {
        rc.smk = (rc.smk || 0) + dt * (4 + cp.k * 0.18);
        const h = r.car.root.rotation.y, fx = Math.cos(h), fz = -Math.sin(h);
        while (rc.smk >= 1) {
          rc.smk -= 1;
          const j = () => Math.random() - 0.5, wx = r.car.root.position.x + fx * D.AXR, wz = r.car.root.position.z + fz * D.AXR;
          smoke.emit(wx + j() * 0.3, 0.2 + Math.random() * 0.15, wz + j() * 0.3, -fx * 2.5 + j() * 1.5, 0.6 + Math.random(), -fz * 2.5 + j() * 1.5, 0.5 + Math.random() * 0.4, 1.6 + Math.random() * 1.2, E46.smokeRGB(r.cfg));
        }
      }
      if (cp.cam) pipCand = { name: r.name, cam: cp.cam };
      else rc.m = null;
    }
    // fremdes Martinshorn nur, wenn die eigene Polizei gerade nicht unterwegs ist
    if (cop.phase === 'off' && Sound.siren) {
      if (sir > 0.01) { Sound.siren(mode === 'drive' ? sir : 0, sirPan); rcSiren = true; }
      else if (rcSiren) { Sound.siren(0, 0); rcSiren = false; }
    }
    updatePip(dt, pipCand);
  }
  // Live-Fenster: Filmkamera des anderen Spielers, unten links
  const pipCam = new T.PerspectiveCamera(55, 16 / 9, 0.1, 4000);
  const pip = { on: false, hold: 0, pos: new T.Vector3(), look: new T.Vector3(), el: null };
  function updatePip(dt, cand) {
    if (cand) {
      const c = cand.cam, P = cshV1.set(c[0], c[1], c[2]), L = cshV2.set(c[3], c[4], c[5]);
      if (!pip.on) { pip.pos.copy(P); pip.look.copy(L); pip.on = true; }
      else { const q = 1 - Math.exp(-dt * 8); pip.pos.lerp(P, q); pip.look.lerp(L, q); }
      pip.hold = 1.2;
      if (!pip.el) { pip.el = document.createElement('div'); pip.el.id = 'pipBox'; document.body.appendChild(pip.el); }
      pip.el.innerHTML = '<span class="pipTag"><b>🔴 LIVE</b> ' + esc(cand.name) + ' wird getaferlt</span>';
    } else if (pip.on) { pip.hold -= dt; if (pip.hold <= 0) pip.on = false; }
    if (pip.el) pip.el.classList.toggle('on', pip.on && pipVisible());
    pipCam.position.copy(pip.pos); pipCam.lookAt(pip.look);
  }
  const pipVisible = () => (mode === 'drive' || mode === 'pause' || mode === 'spectate') && (!show.on || SHOT);
  function pipRect() { const w = Math.round(Math.min(440, innerWidth * 0.38)), h = Math.round(w * 9 / 16); return { x: 16, y: 64, w, h }; }
  function renderPip() {
    if (!pip.on || !pipVisible()) return;
    const R = pipRect();
    if (pip.el) { pip.el.style.width = R.w + 'px'; pip.el.style.height = R.h + 'px'; pip.el.style.left = R.x + 'px'; pip.el.style.bottom = R.y + 'px'; }
    pipCam.aspect = R.w / R.h; pipCam.updateProjectionMatrix();
    renderer.setRenderTarget(null);
    renderer.setViewport(R.x, R.y, R.w, R.h); renderer.setScissor(R.x, R.y, R.w, R.h); renderer.setScissorTest(true);
    // Qualm/Funken haben eine feste Pixelgröße -> im kleinen Fenster entsprechend verkleinern
    const pm = [smoke, sparks].map(o => o && o.mat && o.mat.uniforms && o.mat.uniforms.scale).filter(Boolean), k = R.h / innerHeight, old = pm.map(u => u.value);
    pm.forEach(u => { u.value *= k; });
    renderer.render(driveScene, pipCam);
    pm.forEach((u, i) => { u.value = old[i]; });
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  function updatePolice(dt, spd) {
    // eigene Spur aufzeichnen (für die Verfolgung)
    const last = cop.trail[cop.trail.length - 1];
    if (!last || Math.hypot(last.x - phys.x, last.z - phys.z) > 0.4) { cop.trail.push({ x: phys.x, z: phys.z }); if (cop.trail.length > 700) cop.trail.shift(); }
    if (cop.phase === 'off') {
      const ok = car.model === 'moped' && car.hasPlate && car.hasPlate() && !chal.on && lift.phase === 'idle' && !track.inPaddock(phys.x, phys.z);
      cop.fast = ok && spd * 3.6 > COP_LIMIT ? cop.fast + dt : Math.max(0, cop.fast - dt * 0.5);
      if (ok) cop.vmax = Math.max(cop.fast > 0 ? (cop.vmax || 0) : 0, spd * 3.6);   // Höchstwert für die Messung am Prüfstand
      if (cop.fast > 1.5) copStart();
      return;
    }
    cop.t += dt;
    const fx = Math.cos(phys.h), fz = -Math.sin(phys.h), rx = Math.sin(phys.h), rz = Math.cos(phys.h);
    if (cop.phase === 'chase' || cop.phase === 'stop') cop.vmax = Math.max(cop.vmax || 0, spd * 3.6);
    if (cop.phase === 'chase') {
      // Wunschabstand schrumpft von ~50 m auf 7 m; der Nachlauf der weichen Bewegung (v / k) wird ausgeglichen
      const p = trailBack(Math.max(1, Math.max(7, 50 - cop.t * 6.5) - phys.speed / 3.2));
      copMoveTo(p.x, p.z, dt, 3.2);
      if (cop.t > COP_CHASE && Math.hypot(cop.x - phys.x, cop.z - phys.z) < 14) { cop.phase = 'stop'; cop.t = 0; popup('ANHALTEN!', 'Polizeikontrolle – rechts ran!', true); }
    } else if (cop.phase === 'stop') {
      // überholt links und stellt sich schräg vor das Moped
      const tx = phys.x + fx * 6.5 - rx * 1.6, tz = phys.z + fz * 6.5 - rz * 1.6;
      const d = copMoveTo(tx, tz, dt, 2.2, cop.t > 1.2 ? phys.h - 0.35 : null);
      if (cop.t > 2.2 && spd < 0.6 && d < 0.8) {
        cop.t = 0;
        if (window.CopShow && car.model === 'moped' && car.setPlateOff) { cop.phase = 'show'; copShowStart(); }   // der große Film
        else { cop.phase = 'talk'; popup('AMTSHANDLUNG', 'Fahrzeugkontrolle …', false); }
      }
    } else if (cop.phase === 'show') {
      copMoveTo(cop.x, cop.z, dt, 1);
      copShowUpdate(dt);
    } else if (cop.phase === 'talk') {
      copMoveTo(cop.x, cop.z, dt, 1);
      if (cop.t > 2.6 && car.hasPlate && car.hasPlate()) {
        car.setPlateOff(true); Sound.click && Sound.click();
        popup('GETAFERLT!', 'Kennzeichen abgenommen – 45 km/h heißt 45!', true);
        chatDrift('police', 1);
      }
      if (cop.t > 5.2) { cop.phase = 'leave'; cop.t = 0; }
    } else if (cop.phase === 'leave') {
      const hx = Math.cos(cop.h), hz = -Math.sin(cop.h), v = Math.min(28, 4 + cop.t * 6);
      copMoveTo(cop.x + hx * v, cop.z + hz * v, dt, 1);
      if (cop.t > 7) { copReset(); return; }
    }
    // Darstellung: Position, Räder, Blaulicht, Martinshorn
    const pc = cop.car, R = pc.dims.WHEEL_R;
    pc.root.position.set(cop.x, track.groundAt ? track.groundAt(cop.x, cop.z, phys.trackIdx) : 0, cop.z); pc.root.rotation.y = cop.h;
    pc.update({ frontSpin: cop.v / R * dt, rearSpin: cop.v / R * dt, steer: 0, roll: 0, pitch: 0 });
    pc.setBrake(cop.phase === 'stop' || cop.phase === 'talk' || cop.phase === 'show');
    const fl = (performance.now() / 1000 * 4) % 2 < 1, on = cop.phase !== 'leave' || cop.t < 2;
    cop.lamps[0].color.setHex(on && fl ? 0x4f74ff : 0x0a1440); cop.lamps[1].color.setHex(on && !fl ? 0x4f74ff : 0x0a1440);
    cop.light.intensity = on ? (fl ? 2.2 : 1.2) : 0;
    const dist = Math.hypot(cop.x - phys.x, cop.z - phys.z);
    camera.updateMatrixWorld();
    const rel = new T.Vector3(cop.x, 1, cop.z).applyMatrix4(camera.matrixWorldInverse);
    const sirOn = (cop.phase === 'chase' || cop.phase === 'stop') ? 1 / (1 + Math.pow(dist / 30, 2)) : 0;
    Sound.siren && Sound.siren(mode === 'drive' ? sirOn : 0, rel.x / Math.max(4, Math.abs(rel.x) + Math.abs(rel.z)) * 0.8);
  }
  function updateDrive(dt) {
    const inp = readInput();
    // auf der Hebebühne: Auto steht fest (Gas/Lenken gesperrt, bis man in der Garage ist)
    if (lift.phase === 'up' || lift.phase === 'fade') { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.handbrake = true; inp.shiftUp = inp.shiftDown = false; }
    // Polizei: anhalten (Bremse < 0,5, sonst schaltet die Automatik auf R) und stehen bleiben
    if (cop.phase === 'stop' && cop.t > 0.8) { inp.throttle = 0; inp.brake = 0.45; inp.handbrake = phys.speed < 3; }
    if (cop.phase === 'talk' || cop.phase === 'show') { inp.throttle = 0; inp.brake = 0.45; inp.steer = 0; inp.handbrake = true; inp.shiftUp = inp.shiftDown = false; }
    // Challenge: im Countdown steht das Auto (Handbremse), nach dem Ziel rollt es aus
    if (chal.on && chal.phase === 'count') { inp.handbrake = true; inp.brake = Math.min(inp.brake, 0.45); }   // < 0.5: sonst schaltet die Automatik auf R
    if (chal.on && chal.phase === 'done') { inp.throttle = 0; inp.brake = 0.5; }
    // Jonny ist aus dem Rollstuhl gefallen: Rollstuhl bleibt stehen, Gas (neu drücken) = wieder einsteigen
    const jf = car.fallState ? car.fallState() : 'seat';
    if (jf !== 'seat') {
      const gas = inp.throttle > 0.3;
      if (jf === 'down' && gas && !jonnyFall.gasPrev) car.climbIn();
      if (jf === 'down' && !jonnyFall.hinted) { jonnyFall.hinted = true; popup('JONNY LIEGT AM BODEN', 'Gas geben zum Einsteigen', true); }
      jonnyFall.gasPrev = gas;
      inp.throttle = 0; inp.brake = 0.45; inp.steer = 0; inp.handbrake = true; inp.shiftUp = inp.shiftDown = false;
    }
    // Admin-Flip: auf dem Dach geht nichts mehr
    flip.k = Math.max(0, Math.min(1, flip.k + (flip.on ? 1 : -1) * dt / 0.9));
    if (flip.on || flip.k > 0) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.handbrake = true; inp.shiftUp = inp.shiftDown = false; }
    // Tank leer: kaum noch Leistung
    if (track.fuel && cfg.fuelOn && fuel <= 0) inp.throttle *= 0.12;
    acc += dt;
    let n = 0, hit = 0, carHit = 0;
    while (acc >= STEP && n < 12) {
      prevState.x = phys.x; prevState.z = phys.z; prevState.h = phys.h;
      phys.highway = !!track.highway;
      phys.step(STEP, inp);
      hit = Math.max(hit, track.collide(phys, car.collide ? car.collide[0] : 2.25, car.collide ? car.collide[1] : 0.88));
      phys.groundY = track.groundAt ? track.groundAt(phys.x, phys.z, phys.trackIdx) : 0;   // Brücke/Rampe
      phys.grade = track.gradeAt ? track.gradeAt(phys.trackIdx, phys.h) : 0;
      carHit = Math.max(carHit, Net.collide(phys));
      if (track.collideTraffic) hit = Math.max(hit, track.collideTraffic(phys));   // Autobahn: Unfall mit dem Verkehr
      inp.shiftUp = inp.shiftDown = false;
      acc -= STEP; n++;
    }
    if (hit > 3.5 && jf === 'seat' && car.fallOut && !show.on && !(chal.on && chal.phase === 'count')) {
      car.fallOut(); jonnyFall.gasPrev = true; jonnyFall.hinted = false;
      popup('JONNY IST RAUSGEFALLEN!', '', true);
      if (window.Jonny) Jonny.showBubble(car.root, 'AUAAA!', 1.95);
    }
    phys.jonnyFall = car.fallState && car.fallState() !== 'seat' ? 1 : 0;
    if (flip.on) { phys.vx = phys.vz = phys.u = phys.r = phys.spin = 0; }   // liegt still auf dem Dach
    phys.flip = flip.k;
    if (n >= 12) { acc = 0; prevState.x = phys.x; prevState.z = phys.z; prevState.h = phys.h; }
    if (n === 0 && prevState.x === 0 && prevState.z === 0) { prevState.x = phys.x; prevState.z = phys.z; prevState.h = phys.h; }

    // Auto platzieren
    // zwischen zwei Physikschritten interpolieren -> kein Ruckeln
    const al = acc / STEP;
    const ix = prevState.x + (phys.x - prevState.x) * al, iz = prevState.z + (phys.z - prevState.z) * al;
    const ih = prevState.h + (phys.h - prevState.h) * al;
    // Fahrbahnhöhe an der (interpolierten) Bildposition unter Vorder- und Hinterachse -> Räder bleiben auf der Straße, kein Ruckeln
    let gY = phys.groundY || 0, pitch = Math.atan(phys.grade || 0);
    if (track.groundAt && (track.bridge || track.terrainH)) {
      const hx = Math.cos(ih), hz = -Math.sin(ih), aF = car.dims.AXF, aR = car.dims.AXR;
      const yF = track.groundAt(ix + hx * aF, iz + hz * aF, phys.trackIdx), yR = track.groundAt(ix + hx * aR, iz + hz * aR, phys.trackIdx);
      const target = Math.atan((yF - yR) / (aF - aR));
      phys._pitchS = phys._pitchS == null ? target : phys._pitchS + (target - phys._pitchS) * (1 - Math.exp(-dt * 25));
      pitch = phys._pitchS;
      gY = yR + (yF - yR) * (-aR) / (aF - aR);           // Höhe der Straße unter der Wagenmitte (Linie zwischen den Achsen)
    }
    phys.renderY = gY;
    car.root.position.set(ix, lift.y + gY, iz); phys.liftY = lift.y;
    car.root.rotation.y = ih; car.root.rotation.z = pitch;   // auf der Rampe / am Berg Nase hoch/runter
    Net.applyFlip(car, flip.k);
    const R = car.dims.WHEEL_R;
    car.update({
      frontSpin: phys.u / R * dt,
      rearSpin: phys.hb ? 0 : (phys.u + phys.spin * (phys.u >= 0 ? 1 : -1)) / R * dt,
      steer: phys.steer, roll: phys.roll, pitch: phys.pitch, throttle: phys.throttle, speed: phys.u, beta: phys.beta, dt
    });
    car.setBrake(phys.brakeIn > 0.1 || phys.hb || phys.reverse);
    // Polizei-Film: Moped wird vom Polizisten bewegt (Prüfstand), Hinterrad dreht auf der Walze
    if (show.on) {
      car.root.position.set(show.moped.x, show.moped.y, show.moped.z);
      car.update({ frontSpin: 0, rearSpin: show.spin * dt, steer: 0, roll: 0, pitch: 0, throttle: show.thr, speed: 0, beta: 0 });
    }

    // Effekte
    const fx = Math.cos(phys.h), fz = -Math.sin(phys.h), rx = Math.sin(phys.h), rz = Math.cos(phys.h);
    const spd = phys.speed;
    const vdx = spd > 0.1 ? phys.vx / spd : fx, vdz = spd > 0.1 ? phys.vz / spd : fz;
    const slip = phys.slipR;
    const smokeCol = E46.smokeRGB(cfg);
    const AX = car.dims.AXR, AF = car.dims.AXF, TW = car.dims.trackHalf + cfg.track / 100;
    [1, -1].forEach((sd, k) => {
      const wx = phys.x + fx * AX + rx * sd * TW, wz = phys.z + fz * AX + rz * sd * TW;
      const a = Math.max(0, Math.min(0.6, (slip - 2.5) / 9));
      const sm = car.smokeScale || 1;   // kleine Fahrzeuge: weniger und kleinerer Qualm, schmalere Spuren
      skids.add(k ? 'rl' : 'rr', wx, wz, vdx, vdz, car.skidW || 0.24, spd > 0.5 ? a : 0, gY);
      if (slip > 4) {
        smokeAcc[k] += dt * sm * Math.min(48, (slip - 4) * 4 * (0.7 + Math.min(0.6, Math.max(0, phys.tempR - 60) / 100)));
        while (smokeAcc[k] >= 1) {
          smokeAcc[k] -= 1;
          const j = () => (Math.random() - 0.5);
          smoke.emit(wx + j() * 0.3 - fx * 0.2, gY + 0.3 + Math.random() * 0.15, wz + j() * 0.3 - fz * 0.2,
            phys.vx * 0.3 + j() * 1.6 + rx * sd * 0.8, 0.5 + Math.random() * 0.8, phys.vz * 0.3 + j() * 1.6 + rz * sd * 0.8,
            (0.7 + Math.random() * 0.5) * (0.5 + 0.5 * sm), (1.8 + Math.random() * 1.2) * (0.4 + 0.6 * sm), smokeCol);
        }
      }
      const fwx = phys.x + fx * AF + rx * sd * TW, fwz = phys.z + fz * AF + rz * sd * TW;
      skids.add(k ? 'fl' : 'fr', fwx, fwz, vdx, vdz, 0.22, phys.slipF > 4 ? Math.min(0.4, (phys.slipF - 4) / 10) : 0, gY);
    });
    // Diesel: schwarze Rußwolken aus dem Auspuff (stark beim Gasgeben)
    // Zweitakter: bläulicher Ölqualm, vor allem im Leerlauf und beim Gasgeben
    if (car.twoStroke && cfg.soot > 0) {
      const amt = cfg.soot / 100;
      sootAcc += (2.5 + phys.throttle * 7 + (phys.speed < 2 ? 2 : 0)) * amt * dt;
      while (sootAcc >= 1) {
        sootAcc -= 1;
        const wp = car.chassis.localToWorld(car.exhaust[0].clone());
        const j = () => Math.random() - 0.5, g = 0.68 + Math.random() * 0.12;
        smoke.emit(wp.x, wp.y, wp.z, phys.vx * 0.5 - fx * (1.5 + phys.throttle * 2) + j() * 0.6, 0.35 + Math.random() * 0.5, phys.vz * 0.5 - fz * (1.5 + phys.throttle * 2) + j() * 0.6,
          0.14 + Math.random() * 0.12, 1.1 + Math.random() * 0.8 + amt, [g * 0.9, g * 0.95, g + 0.08]);
      }
    }
    // Bierflasche: Schaum spritzt beim Gasgeben vorne aus dem Flaschenhals, beim Gasstoß besonders viel
    if (car.foamAt && cfg.soot > 0) {
      const amt = cfg.soot / 100;
      if (phys.throttle > 0.6 && !car._thrWas) car._foamKick = 1;
      car._thrWas = phys.throttle > 0.6; car._foamKick = Math.max(0, (car._foamKick || 0) - dt * 1.5);
      sootAcc += (phys.throttle * (4 + phys.rpm / 500) + car._foamKick * 60) * amt * dt;
      while (sootAcc >= 1) {
        sootAcc -= 1;
        const wp = car.chassis.localToWorld(car.foamAt.clone());
        const j = () => Math.random() - 0.5, g = 0.9 + Math.random() * 0.08, push = 2 + phys.throttle * 3 + car._foamKick * 4;
        smoke.emit(wp.x, wp.y, wp.z, phys.vx * 0.7 + fx * push + j() * 1.2, 1.2 + Math.random() * 1.6, phys.vz * 0.7 + fz * push + j() * 1.2,
          0.18 + Math.random() * 0.16 + car._foamKick * 0.15, 0.9 + Math.random() * 0.6, [g, g * 0.95, g * 0.8]);
      }
    }
    if (car.diesel && cfg.soot > 0) {
      const amt = cfg.soot / 100;
      const rate = (phys.throttle * (6 + phys.rpm / 300) + phys.fuelPuff * 90) * amt * (car.exhaustUp ? 1.3 : 1);
      sootAcc += rate * dt;
      while (sootAcc >= 1) {
        sootAcc -= 1;
        const ep = car.exhaust[(Math.random() * car.exhaust.length) | 0];
        const wp = car.chassis.localToWorld(ep.clone());
        const j = () => Math.random() - 0.5;
        const g = 0.12 + Math.random() * 0.1;
        if (car.exhaustUp) smoke.emit(wp.x, wp.y, wp.z, phys.vx * 0.6 - fx * 1.2 + j() * 0.8, 2.6 + phys.throttle * 3.5 + Math.random() * 1.2, phys.vz * 0.6 - fz * 1.2 + j() * 0.8,
          0.3 + Math.random() * 0.25 + phys.fuelPuff * 0.5, 1.6 + Math.random() * 1.2 + amt, [g * 0.8, g * 0.8, g * 0.8 + 0.02]);
        else smoke.emit(wp.x, wp.y, wp.z, phys.vx * 0.5 - fx * (3 + phys.throttle * 4) + j() * 1.2, 0.6 + Math.random() * 0.9, phys.vz * 0.5 - fz * (3 + phys.throttle * 4) + j() * 1.2,
          0.35 + Math.random() * 0.3 + phys.fuelPuff * 0.5, 1.4 + Math.random() * 1.0 + amt, [g, g, g + 0.02]);
      }
    }
    if (phys.blowoff) Sound.blowoff && Sound.blowoff();
    smoke.update(dt);
    skids.update();

    // Fehlzündungen
    popT -= dt;
    let flameOn = false;
    if (!cfg.flames) phys.backfire = 0;
    if (phys.backfire > 0 && popT <= 0) {
      // erster Schuss am lautesten, danach Nachschüsse
      const first = !bangChain; bangChain = true;
      const bfk = Physics.P.backfire == null ? 1 : Physics.P.backfire;   // Regler „Fehlzündungen“ (0 … 2)
      phys.backfire--; popT = (0.09 + Math.random() * 0.14) / (0.7 + 0.3 * bfk);
      Sound.bang((first ? 1.2 : 0.65 + Math.random() * 0.35) * Math.min(1.5, 0.55 + 0.45 * bfk)); rumble(0.2, first ? 0.6 : 0.3, 70);
      bigFlame = (first ? 0.12 : 0.06) * (0.6 + 0.4 * bfk);
      camState.shake = Math.max(camState.shake, first ? 0.12 : 0.05);
      flameOn = true;
    }
    else if (popT > 0.04) flameOn = true;
    // Runterschalten: Zwischengas, lauter Knall, danach Blubbern (nicht bei E-Antrieb)
    const dsNow = phys.downshifts || 0;
    if (dsNow !== dsSeen) {
      if (dsNow > dsSeen && cfg.downPops !== false && !Physics.P.electric && phys.speed > 3 && phys.rpm > Physics.P.idle * 1.1) {   // jedes Runterschalten in Fahrt
        const k = Physics.P.diesel ? 0.6 : 1, t0 = performance.now();
        blipT = 0.16;                                                   // Gasstoß für den Motorsound
        dsQueue.push({ t: t0 + 40, s: 1.15 * k, big: true });           // Hauptknall
        const n = 3 + (Math.random() * 4 | 0);                          // Nachblubbern
        for (let i = 0; i < n; i++) dsQueue.push({ t: t0 + 140 + i * (55 + Math.random() * 70), s: (0.25 + Math.random() * 0.3) * k });
      }
      dsSeen = dsNow;
    }
    blipT = Math.max(0, blipT - dt);
    if (dsQueue.length) {
      const now = performance.now();
      while (dsQueue.length && dsQueue[0].t <= now) {
        const e = dsQueue.shift();
        Sound.bang && Sound.bang(e.s);
        bigFlame = Math.max(bigFlame, e.big ? 0.12 : 0.05);
        if (e.big) { camState.shake = Math.max(camState.shake, 0.08); rumble(0.3, 0.7, 90); } else rumble(0.1, 0.25, 40);
      }
      flameOn = true;
    }
    // 2-Step (Handbremse + Gas im Stand mit Anti-Lag): kurzer Hinweis beim Einschalten
    if (phys.twoStep && !twoStepPrev) popup('2-STEP', 'Handbremse lösen = Start', false);
    twoStepPrev = !!phys.twoStep;
    // Anti-Lag: Dauerfeuer im Schub (unabhängig vom Schalter für Fehlzündungen)
    alsT -= dt;
    if (phys.alsPop > 0) {
      if (alsT <= 0) {
        alsT = (0.05 + Math.random() * 0.13) / (0.6 + phys.alsPop * 0.6);
        if (Math.random() < 0.85) { Sound.bang && Sound.bang(0.3 + Math.random() * 0.45 * phys.alsPop); rumble(0.15, 0.25, 50); }
        bigFlame = Math.max(bigFlame, Math.random() < 0.3 ? 0.08 : 0.03);
      }
      flameOn = true;
    }
    if (phys.backfire <= 0 && popT <= 0) bangChain = false;
    bigFlame = Math.max(0, bigFlame - dt);
    const flK = phys.alsPop > 0 || dsQueue.length > 0 ? 1 : 0.6 + 0.4 * (Physics.P.backfire == null ? 1 : Physics.P.backfire);   // Backfire-Flammen je nach Regler
    flames.update(dt, flameOn && phys.backfire >= 0 && (popT > 0.03 || phys.alsPop > 0 || dsQueue.length > 0 || bigFlame > 0), (bigFlame > 0 ? 2.0 : 1) * flK);

    if (!(chal.on && chal.phase !== 'run')) updateScore(dt, hit);   // Punkte nur während der Challenge-Runde
    if (chal.on) updateChallenge(dt);
    // Hebebühne in der Werkstatt -> anhalten, Bühne fährt das Auto hoch, Überblendung in die Garage
    updatePolice(dt, spd);
    if (peds) peds.update(dt, { x: phys.x, z: phys.z, h: phys.h, vx: phys.vx, vz: phys.vz, speed: spd, halfL: car.collide ? car.collide[0] : 2.25, halfW: car.collide ? car.collide[1] : 0.88 });
    updateSmoking(dt);
    updateShout(dt);
    // Hupe (H / L3) und Lichthupe (L / rechter Stick hoch) – auch für die anderen Spieler
    phys.horn = !!(keys.KeyH || padHorn); phys.flash = !!(keys.KeyL || padFlash);
    Sound.horn && Sound.horn(phys.horn, Physics.engineOf(cfg).key);
    E46.setFlash(car, phys.flash);
    if (updateLift(dt, spd)) return;
    // Sprit
    $('fuel').classList.toggle('hidden', !(track.fuel && cfg.fuelOn));
    if (track.fuel && cfg.fuelOn) {
      fuel = Math.max(0, fuel - dt * (0.00006 + phys.throttle * phys.rpm / Physics.P.redline * 0.0021));
      if (track.atPump(phys.x, phys.z) && spd < 1.5) {
        if (fuel < 0.999) { fuel = Math.min(1, fuel + dt * 0.25); refuelMsg = true; }
        else if (refuelMsg) { refuelMsg = false; popup('VOLLGETANKT', '', false); }
      }
      if (fuel < 0.12 && !fuelWarn) { fuelWarn = true; popup('TANK FAST LEER', 'Fahr zur Tankstelle!', true); }
      if (fuel > 0.3) fuelWarn = false;
      $('fuelFill').style.width = (fuel * 100).toFixed(1) + '%';
      $('fuelFill').style.background = fuel < 0.15 ? '#ff3b3b' : fuel < 0.35 ? '#ffd21f' : '#6fe36f';
    }
    drawMini();
    if (carHit > 2) { Sound.crash(carHit * 0.6); camState.shake = Math.min(0.35, carHit * 0.03); rumble(0.5, Math.min(1, carHit * 0.1), 200); }
    phys.cop = copNetState(); phys.noPlate = !!(car.hasPlate && !car.hasPlate());
    const dyn = show.on && show.rpm > 0; phys.netRpm = dyn ? show.rpm : null; phys.netTh = dyn ? show.thr : null;
    Net.tick(dt, phys);
    netUpdate(dt);
    if (hit > 1 && hit <= 3.5) Sound.crash(hit * 0.5);
    if (hit > 1.2) {
      // Funken dort, wo das Auto an der Mauer schrammt
      const sg = Math.abs(phys.lateral || 0) > track.WALL - 3.5 && !track.inPaddock(phys.x, phys.z) ? Math.sign(phys.lateral) : 0;
      const Sp = track.S[Math.max(0, phys.trackIdx)];
      sparks.burst(phys.x + (sg ? Sp.rx * sg * 0.9 : 0), (phys.groundY || 0) + 0.35, phys.z + (sg ? Sp.rz * sg * 0.9 : 0), phys.vx * 0.5, phys.vz * 0.5, Math.min(40, 8 + hit * 4 | 0), 0.8);
    }

    // HUD
    const onDyno = show.on && show.rpm > 0;   // Polizei-Film: Tacho zeigt, was die Walze misst
    $('speed').textContent = Math.round(onDyno ? show.kmh || 0 : spd * 3.6);
    $('gear').textContent = phys.reverse ? 'R' : phys.gear;
    $('gear').style.color = phys.shiftDenied > 0 ? '#ff3b3b' : '';
    drawTach(onDyno ? show.rpm : phys.rpm);
    const tcol = (T) => T < 55 ? '#6fd3ff' : T < 105 ? '#6fe36f' : T < 135 ? '#ffd21f' : '#ff3b3b';
    $('tempF').textContent = Math.round(phys.tempF) + '°'; $('tempF').style.color = tcol(phys.tempF);
    $('tempR').textContent = Math.round(phys.tempR) + '°'; $('tempR').style.color = tcol(phys.tempR);
    if (show.on && show.rpm > 0) soundUpdate(show.rpm, show.thr, show.thr ? 6 : 0, show.kmh || 0, true, false, 0);   // Vollgas auf der Walze
    else soundUpdate(phys.rpm, blipT > 0 ? Math.max(phys.throttle, 0.85) : phys.throttle, Math.max(slip, phys.slipF * 0.7), spd * 3.6, true, phys.revCut, phys.boost);
    // Vibration beim Driften / durchdrehenden Rädern
    rumbleT -= dt;
    if (rumbleT <= 0) { rumbleT = 0.1; const sl = Math.max(0, Math.min(1, (slip - 4) / 14)); if (sl > 0.05) rumble(sl * 0.45, sl * 0.15, 130); }

    // Tageszeit, Schatten & Licht
    updateWorld(dt, phys.x, phys.z, phys.groundY);
    headSpot.position.set(phys.x + fx * 1.6, 0.8 + lift.y + (phys.groundY || 0), phys.z + fz * 1.6);
    headSpot.target.position.set(phys.x + fx * 26, (phys.groundY || 0) + 26 * (phys.grade || 0), phys.z + fz * 26);
    sparks.update(dt);
    if (!copShowCam(dt)) updateCamera(dt);
  }

  // Minikarte (statischer Teil wird einmal gezeichnet)
  let miniStatic = null, miniCtx = null, miniView = null;
  function drawMini(spectating) {
    if (!miniCtx) miniCtx = $('mini').getContext('2d');
    const W = 200, m = track.mini;
    if (m.local) { drawMiniLocal(spectating); return; }
    if (!miniStatic) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of m.S) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const sc = (W - 24) / Math.max(x1 - x0, z1 - z0), ox = W / 2 - (x0 + x1) / 2 * sc, oz = W / 2 - (z0 + z1) / 2 * sc;
      miniView = { sc, ox, oz };
      const c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d');
      const P = (x, z) => [ox + x * sc, oz + z * sc];
      g.lineJoin = 'round'; g.lineCap = 'round';
      const pathLine = (pts, closed, w, col) => { g.beginPath(); pts.forEach((p, i) => { const q = P(p.x, p.z); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (closed) g.closePath(); g.lineWidth = w; g.strokeStyle = col; g.stroke(); };
      pathLine(m.S, true, Math.max(5, 26 * sc), '#111318'); pathLine(m.S, true, Math.max(3, 16 * sc), '#dfe3ea');
      pathLine(m.pit, false, Math.max(3, 10 * sc), '#9aa3b5');
      const rect = (R, col) => { const a = P(R.x0, R.z0), b = P(R.x1, R.z1); g.fillStyle = col; g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); };
      rect(m.yard, '#9aa3b5'); rect(m.hall, '#1c69d4'); rect(m.lift, '#ffd21f');
      if (m.gas) { const q = P(m.gas.cx, m.gas.cz); g.fillStyle = '#d32b2b'; g.fillRect(q[0] - 5, q[1] - 4, 10, 8); g.fillStyle = '#fff'; g.font = 'bold 8px Arial'; g.textAlign = 'center'; g.fillText('⛽', q[0], q[1] + 3); }
      const s0 = P(track.start.x, track.start.z); g.fillStyle = '#ff3b3b'; g.fillRect(s0[0] - 2, s0[1] - 2, 4, 4);
      miniStatic = c;
    }
    const g = miniCtx, v = miniView;
    g.clearRect(0, 0, W, W); g.drawImage(miniStatic, 0, 0);
    const dot = (x, z, h, col, me) => {
      const px = v.ox + x * v.sc, pz = v.oz + z * v.sc;
      g.save(); g.translate(px, pz); g.rotate(-h);
      g.beginPath(); g.moveTo(me ? 7 : 6, 0); g.lineTo(-5, -4.5); g.lineTo(-5, 4.5); g.closePath();
      g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#111318'; g.stroke(); g.restore();
    };
    for (const r of Net.remotes.values()) if (r.cur) dot(r.cur.x, r.cur.z, r.cur.h, Net.slotColor(r.slot), spectating && r === spec.target);
    if (!spectating) dot(phys.x, phys.z, phys.h, '#ffd21f', true);
  }

  // Minikarte Autobahn: Ausschnitt ums Auto (Fahrtrichtung oben), Verkehr als Punkte
  function drawMiniLocal(spectating) {
    const g = miniCtx, W = 200, m = track.mini, sc = 0.55;
    const cx = spectating ? camera.position.x : phys.x, cz = spectating ? camera.position.z : phys.z;
    const i = track.nearest(cx, cz), p = track.S[i], a = Math.atan2(p.tz, p.tx);     // Straße zeigt nach oben
    const ca = Math.cos(-a - Math.PI / 2), sa = Math.sin(-a - Math.PI / 2);
    const P = (x, z) => { const dx = (x - cx) * sc, dz = (z - cz) * sc; return [W / 2 + dx * ca - dz * sa, W * 0.62 + dx * sa + dz * ca]; };
    g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(70,110,60,0.55)'; g.fillRect(0, 0, W, W);
    const band = (l0, l1, col) => {
      g.beginPath();
      for (let s = -260; s <= 260; s += 20) { const q = m.pose(p.x + s * p.tx, l0), r = P(q.x, q.z); s === -260 ? g.moveTo(r[0], r[1]) : g.lineTo(r[0], r[1]); }
      for (let s = 260; s >= -260; s -= 20) { const q = m.pose(p.x + s * p.tx, l1), r = P(q.x, q.z); g.lineTo(r[0], r[1]); }
      g.closePath(); g.fillStyle = col; g.fill();
    };
    band(-24.6, 7.9, '#2b2e34'); band(-8.6, -7.9, '#b9bbb8');
    for (const v of m.traffic) {
      if (v.wx == null) continue;
      const r = P(v.wx, v.wz); if (r[1] < -10 || r[1] > W + 10) continue;
      g.save(); g.translate(r[0], r[1]); g.rotate(-v.h - a);
      g.fillStyle = v.tpl.truck ? '#f2c21b' : v.dir > 0 ? '#e8ecf2' : '#8a93a3';
      const L = v.tpl.len * sc, Wd = v.tpl.wid * sc; g.fillRect(-Wd / 2, -L / 2, Wd, L); g.restore();
    }
    const dot = (x, z, h, col) => {
      const r = P(x, z);
      g.save(); g.translate(r[0], r[1]); g.rotate(-h - a - Math.PI / 2);
      g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -4.5); g.lineTo(-5, 4.5); g.closePath();
      g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#111318'; g.stroke(); g.restore();
    };
    for (const r of Net.remotes.values()) if (r.cur) dot(r.cur.x, r.cur.z, r.cur.h, Net.slotColor(r.slot));
    if (!spectating) dot(phys.x, phys.z, phys.h, '#ffd21f');
    g.restore();
  }

  // Drehzahlmesser
  let tachCtx = null;
  function drawTach(rpm) {
    if (!tachCtx) tachCtx = $('tach').getContext('2d');
    const g = tachCtx, W = 260, cx = 130, cy = 130, r = 112;
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(cx, cy, r + 10, 0, Math.PI * 2); g.fillStyle = 'rgba(16,18,24,0.86)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#111318'; g.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, maxR = Physics.P.redline <= 3000 ? 3000 : Physics.P.redline > 10000 ? 12000 : Physics.P.redline > 8000 ? 10000 : 8000, stepR = maxR <= 3000 ? 500 : 1000;   // Traktor bis 3000, E-Motor bis 10000, Moped bis 12000
    const ang = (v) => a0 + (a1 - a0) * v / maxR;
    g.lineWidth = 12; g.lineCap = 'butt';
    const red = Physics.P.redline - 300;
    g.beginPath(); g.arc(cx, cy, r - 8, ang(red), a1); g.strokeStyle = '#ff3b3b'; g.stroke();
    g.beginPath(); g.arc(cx, cy, r - 8, a0, ang(Math.min(rpm, maxR))); g.strokeStyle = rpm > red ? '#ff3b3b' : '#ffd21f'; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = '900 15px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= maxR / stepR; i++) {
      const a = ang(i * stepR);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); g.lineTo(cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18));
      g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      if ((i * stepR) % 1000 === 0) g.fillText(i * stepR / 1000, cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32));
    }
    const a = ang(Math.min(rpm, maxR));
    g.beginPath(); g.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
    g.lineWidth = 5; g.strokeStyle = '#ff3b3b'; g.lineCap = 'round'; g.stroke();
    g.font = '700 10px Arial'; g.fillStyle = '#9aa3b5'; g.fillText('x1000 U/min', cx, cy + 102);
  }

  // ---------- Garage-Update ----------
  function updateGarage(dt) {
    if (!dragging) { dragVel *= Math.exp(-dt * 3); garageTurn += dragVel + dt * 0.18; }
    car.root.rotation.y = garageTurn;
    garageScene.userData.plat.rotation.y = garageTurn;
    const narrow = innerWidth < 820;
    camera.fov = narrow ? 50 : 34;
    camera.position.set(narrow ? 7.5 : 9.2, narrow ? 2.4 : 2.0, narrow ? 7.5 : 6.4);
    camera.lookAt(0, 0.55, 0);
    camera.clearViewOffset();
    if (!narrow) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.14, 0, innerWidth, innerHeight);
    else camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.2, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    // nur für Test-Screenshots: #shot&view=Drehwinkel,Abstand,Höhe
    const sv = SHOT && location.hash.match(/view=(-?[\d.]+),([\d.]+),(-?[\d.]+)/);
    if (sv) {
      car.root.rotation.y = garageTurn = 0; garageScene.userData.plat.rotation.y = 0;
      const a = +sv[1] * Math.PI / 180, d = +sv[2];
      camera.fov = 30; camera.clearViewOffset();
      camera.position.set(Math.cos(a) * d, +sv[3], Math.sin(a) * d); camera.lookAt(0, 0.62, 0);
      camera.updateProjectionMatrix();
      document.body.classList.add('shot-noui');
    }
  }

  // ---------- Hauptschleife ----------
  let last = performance.now();
  function frame(now) {
    if (!SHOT) requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    padMenu(dt);
    wheelFrame(dt);
    if (mode === 'garage') { updateGarage(dt); post.bloom = 0.3; post.threshold = 0.9; draw(garageScene); }
    else if (mode === 'drive') { camera.clearViewOffset(); updateDrive(dt); draw(driveScene); }
    if (padWorkshop) { padWorkshop = false; if (mode === 'drive') toWorkshop(); }
    else if (mode === 'pause') { netUpdate(dt); updateWorld(dt, phys.x, phys.z, phys.groundY); draw(driveScene); }
    remoteAudio();
    if (mode === 'drive' || mode === 'pause' || mode === 'spectate') remoteLift();
    if (mode === 'spectate') { camera.clearViewOffset(); netUpdate(dt); smoke.update(dt); skids.update(); updateSpectate(dt); updateWorld(dt, camera.position.x, camera.position.z, (spec.target && spec.target.cur && spec.target.cur.gy) || 0); drawMini(true); draw(driveScene); }
  }
  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }

  // Für Tests / Screenshots (nur mit #shot in der URL)
  function shotScenario() {
    const h = location.hash;
    let t = 0;
    if (h.indexOf('demo') >= 0) { cfg.spoiler = 1; cfg.smoke = 5; cfg.angel = 1; cfg.paint = 3; car.setPaint(E46.PAINTS[3].hex); cfg.plate = 'DRIFT 46'; applyLook(); }
    const mp = h.match(/map=(\w+)/); if (mp) switchMap(mp[1]);
    const td = h.match(/tod=([\d.]+)/); if (td) todShot = +td[1];
    if (h.indexOf('nofx') >= 0) post.enabled = false;
    const at = h.match(/at=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/);
    const mm = h.match(/model=(\w+)/);
    const en = h.match(/eng=(\d)/);
    if (mm) { cfg.model = mm[1]; if (en) cfg.engines = { [mm[1]]: +en[1] }; buildCar(); car.root.position.set(0, 0.08, 0); car.root.rotation.set(0, garageTurn, 0); car.update({ frontSpin: 0, rearSpin: 0, steer: 0.38, roll: 0, pitch: 0 }); Physics.applyTuning(cfg); refreshUI(); }
    const fi = h.match(/finish=(\d)/); if (fi) car.setLook({ finish: +fi[1] });
    if (h.indexOf('camo') >= 0 && car.setCamo) car.setCamo(true);
    const pa = h.match(/paint=(\d+)/); if (pa) car.setPaint(E46.PAINTS[+pa[1]].hex);
    const tm = h.match(/tab=(\w+)/); if (tm) document.querySelector('[data-tab=' + tm[1] + ']').click();
    if (h.indexOf('drive') >= 0) {
      if (h.indexOf('lap') >= 0) startChallenge('time'); else startDrive();   // lap = Zeitrennen, lapdone = gleich ins Ziel
      const steps = parseFloat((h.match(/[&#]t=([\d.]+)/) || [0, 4])[1]) * 60;
      const camI = parseInt((h.match(/cam=(\d)/) || [0, 0])[1]);
      for (let c = 0; c < camI; c++) nextCam();
      if (at) { phys.reset(+at[1], +at[2], +at[3]); prevState.x = phys.x; prevState.z = phys.z; prevState.h = phys.h; phys._hints = null; camState.init = false; }
      if (h.indexOf('peds') >= 0 && peds) peds.test();
      // tandem: erfundener zweiter Spieler fährt 7 m hinter mir genau meine Linie (Test Tandem-Multiplikator)
      if (h.indexOf('tandem') >= 0) Net._handle({ t: 'join', id: 'fake', slot: 1, name: 'Kollege', cfg: Object.assign({}, cfg, { map: cfg.map }) });
      // copshow: Polizei-Film sofort starten (mit model=moped), t = Sekunden im Film
      if (h.indexOf('copshow') >= 0 && car.setPlateOff) {
        const pc = copBuild(), fx = Math.cos(phys.h), fz = -Math.sin(phys.h), rx = Math.sin(phys.h), rz = Math.cos(phys.h);
        cop.x = phys.x + fx * 6.5 - rx * 1.6; cop.z = phys.z + fz * 6.5 - rz * 1.6; cop.h = phys.h - 0.35; cop.vmax = 84;
        driveScene.add(pc.root); cop.phase = 'show'; cop.t = 0; copShowStart();
        // netloop: ein erfundener zweiter Spieler bekommt genau die Netzdaten, 30 m weiter seitlich (Test der Übertragung)
        if (h.indexOf('netloop') >= 0) Net._handle({ t: 'join', id: 'fake', slot: 1, name: 'Kollege', cfg: Object.assign({}, cfg, { model: 'moped', map: cfg.map }) });
      }
      for (let i = 0; i < steps; i++) {
        const tt = i / 60;
        keys.KeyW = true;
        keys.KeyA = tt > 5.0 && tt < 6.2; keys.KeyD = tt > 6.5 && tt < 6.7;
        keys.Space = tt > 5.1 && tt < 5.3;
        const hold = h.match(/hold=(\w+)/); if (hold) keys[hold[1]] = tt > 0.8;
        if (h.indexOf('lift') >= 0) keys.KeyW = tt < steps / 60 - 0.25;   // am Ende Gas weg (Fehlzündungen)
        shotSkip = i < steps - 2;
        last = t; t += 1000 / 60; frame(t);
        if (h.indexOf('netloop') >= 0) {
          const sn = JSON.parse(JSON.stringify(Net.snapshot(phys))), DX = 45;   // 45 m weiter vorne auf der Geraden
          sn.x += DX; const cp = sn.cp;
          if (cp) { cp.x += DX; if (cp.f) cp.f[0] += DX; if (cp.d) cp.d[0] += DX; if (cp.m) cp.m[0] += DX; if (cp.cam) { cp.cam[0] += DX; cp.cam[3] += DX; } }
          sn.id = 'fake'; Net._handle(sn);
        }
        if (h.indexOf('tandem') >= 0) {
          const sn = JSON.parse(JSON.stringify(Net.snapshot(phys))), sp = Math.max(1, phys.speed);
          sn.x -= phys.vx / sp * 7; sn.z -= phys.vz / sp * 7; sn.id = 'fake'; Net._handle(sn);
        }
        if (h.indexOf('lapdone') >= 0 && i === steps - 3 && chal.phase === 'run') chal.progress = chal.goal;
        if (h.indexOf('probe') >= 0) window.__maxSd = Math.max(window.__maxSd || -9, track.sd(phys.x, phys.z));
        if (h.indexOf('trace') >= 0 && i % 15 === 0) (window.__trace = window.__trace || []).push((i / 60).toFixed(2) + 's ' + phys.x.toFixed(0) + ',' + phys.z.toFixed(0) + ' i' + phys.trackIdx + ' y' + (phys.groundY || 0).toFixed(1) + ' ' + Math.round(phys.speed * 3.6) + 'km/h' + (track.traffic ? (() => { let b = null, bd = 1e9; for (const v of track.traffic) { if (v.wx == null) continue; const d = Math.hypot(v.wx - phys.x, v.wz - phys.z); if (d < bd) { bd = d; b = v; } } return b ? ' veh ' + bd.toFixed(1) + 'm v' + Math.round(b.v * 3.6) + ' hit' + b.hitT.toFixed(1) + ' lat' + b.lat.toFixed(1) + ' me' + (phys.lateral || 0).toFixed(1) : ''; })() : ''));
      }
      if (h.indexOf('trace') >= 0) {   // trace: Verlauf Position / Streckenindex / Fahrbahnhöhe / Tempo
        const d = document.createElement('div'); d.textContent = window.__trace.join(' | ');
        d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:13px monospace;padding:6px;max-width:1080px'; document.body.appendChild(d);
      }
    } else {
      for (let i = 0; i < 3; i++) { last = t; t += 16; frame(t); }
    }
    // Test Zeitrennen: Auto nach dem Countdown automatisch einmal die Strecke entlang schieben (1 Punkt pro Frame)
    if (h.indexOf('lapauto') >= 0) {
      for (const k in keys) keys[k] = false;
      let j = phys.trackIdx >= 0 ? phys.trackIdx : track.startI - 12, n = 0, log = [];
      while (n < track.N * 2 + 600 && chal.phase !== 'done') {
        if (chal.phase === 'run') {
          const back = h.indexOf('lapwrong') >= 0 && chal.t < 200 / 60;   // lapwrong: erst 200 Punkte rückwärts
          j = (j + (back ? -1 : 1) + track.N) % track.N; const p = track.S[j];
          if (back && !window.__wrongSeen && document.querySelector('#popups .bad')) window.__wrongSeen = true;
          phys.x = p.x; phys.z = p.z; phys.h = Math.atan2(-p.tz, p.tx); phys.vx = p.tx * 20; phys.vz = p.tz * 20;
        }
        shotSkip = true; last = t; t += 1000 / 60; frame(t); n++;
        if (n % 400 === 0) log.push(Math.round(chal.progress) + '/' + chal.goal);
      }
      shotSkip = false; last = t; t += 1000 / 60; frame(t);
      const d = document.createElement('div'); d.textContent = 'Map ' + track.id + ' N=' + track.N + ' Phase ' + chal.phase + ' nach ' + n + ' Frames · Fortschritt ' + log.join(' ') + (h.indexOf('lapwrong') >= 0 ? ' · Warnung gezeigt: ' + !!window.__wrongSeen : '');
      d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:16px monospace;padding:6px;max-width:1000px'; document.body.appendChild(d);
    }
    if (h.indexOf('xback') >= 0) {
      const before = Math.round(phys.x) + ',' + Math.round(phys.z);
      for (const k in keys) keys[k] = false;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
      for (let i = 0; i < 30; i++) { last = t; t += 1000 / 60; frame(t); }
      document.title = 'vorher ' + before + ' nachher ' + Math.round(phys.x) + ',' + Math.round(phys.z) + ' start ' + Math.round(track.start.x) + ',' + Math.round(track.start.z);
      const d = document.createElement('div'); d.textContent = document.title; d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:20px monospace;padding:6px'; document.body.appendChild(d);
    }
    if (h.indexOf('peds') >= 0 && peds) {
      const d = document.createElement('div'); d.textContent = 'Fußgänger erwischt: ' + peds.hits() + ' von ' + peds.count();
      d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:20px monospace;padding:6px'; document.body.appendChild(d);
    }
    if (h.indexOf('probe') >= 0) {
      const d = document.createElement('div');
      d.textContent = 'Map ' + track.id + ' | Pos ' + phys.x.toFixed(1) + ', ' + phys.z.toFixed(1) + ' | Abstand zur Fahrbahngrenze ' + track.sd(phys.x, phys.z).toFixed(2) + ' (negativ = drin) | max ' + (window.__maxSd || 0).toFixed(2) + ' | ' + Math.round(phys.speed * 3.6) + ' km/h';
      d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:18px monospace;padding:6px'; document.body.appendChild(d);
    }
    // wheeltest: erfundenes Logitech-Lenkrad durchläuft den Einrichtungs-Assistenten, danach wird eine Fahr-Eingabe gelesen
    if (h.indexOf('wheeltest') >= 0) {
      const fake = { id: 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d)', axes: [0, 0.02, 1, 1, 1, 0], buttons: [...Array(24)].map(() => ({ pressed: false, value: 0 })) };
      navigator.getGamepads = () => [fake];
      const savedMode = wheel.mode; wheel.mode = 'auto';
      Object.assign(wiz, { on: true, step: 0, base: null, best: null, held: false });
      const seq = [[0, 0.05], [2, -1], [3, -0.9]];   // Lenkachse etwas nach rechts, Gas (1 -> -1), Bremse (1 -> -0,9)
      const steps = [];
      for (const [ax, v] of seq) { steps.push(() => {}); steps.push(() => { fake.axes[ax] = v; }); steps.push(() => { fake.axes[ax] = v; }); steps.push(() => { fake.axes[ax] = ax === 0 ? 0 : 1; }); steps.push(() => {}); }
      for (const bi of [1, 5, 4]) { steps.push(() => {}); steps.push(() => { fake.buttons[bi] = { pressed: true, value: 1 }; }); steps.push(() => { fake.buttons[bi] = { pressed: false, value: 0 }; }); steps.push(() => {}); }
      for (const f of steps) { f(); wheelFrame(); }
      const cal = JSON.stringify({ steerAx: wheel.steerAx, steerSign: wheel.steerSign, gasAx: wheel.gasAx, gasFull: wheel.gasFull, brkAx: wheel.brkAx, brkFull: wheel.brkFull, hb: wheel.hbBtn, up: wheel.upBtn, dn: wheel.dnBtn, wizOn: wiz.on });
      // Fahren: 90° nach rechts (bei 450° Lenkbereich -> -0,4), Gas halb, Bremse los, Handbremse gedrückt
      for (const k in keys) keys[k] = false;
      fake.axes[0] = 0.1; fake.axes[2] = 0; fake.axes[3] = 1; fake.buttons[1] = { pressed: true, value: 1 };
      const r = readInput();
      wheel.mode = savedMode;
      const d = document.createElement('div'); d.textContent = 'Kalibrierung ' + cal + ' | Eingabe steer ' + r.steer.toFixed(2) + ' gas ' + r.throttle.toFixed(2) + ' bremse ' + r.brake.toFixed(2) + ' hb ' + r.handbrake;
      d.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9;background:#000;color:#0f0;font:15px monospace;padding:6px;max-width:1080px'; document.body.appendChild(d);
    }
    const im = new Image(); im.src = renderer.domElement.toDataURL();
    im.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:4;pointer-events:none';
    document.body.appendChild(im);
  }
  let lastHook = 0;
  window.__game = { get phys() { return phys; }, get car() { return car; }, startDrive, enterGarage, readInput, frame: (t) => frame(t), keys, get renderer() { return renderer; }, get camera() { return camera; }, nextCam };
  if (SHOT) init();
})();
