/* =====================================================================
   Himmel & Tageszeit
   - Sonnenstand aus der Uhrzeit (Aufgang ca. 6 Uhr, Untergang ca. 18 Uhr)
   - Farben für Himmel, Nebel, Sonne/Mond und Umgebungslicht werden
     zwischen Stützpunkten nach der Sonnenhöhe überblendet
   - nachts: Sterne, Mond, Mondlicht
   Automatik: ein ganzer Tag dauert 12 Minuten und hängt an der echten
   Uhr – dadurch sehen online alle Spieler dieselbe Tageszeit.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const C = (h) => new T.Color(h);
  const WHITE = C(0xffffff);

  // Stützpunkte nach Sonnenhöhe in Grad
  const KEYS = [
    //  Höhe  Zenit      Horizont   Glut       Glut  Licht      Stärke Himmelslicht Bodenlicht  Stärke Wolken    Sterne
    { el: -18, top: C(0x040812), hor: C(0x0f1a36), glow: C(0x1d2c55), gk: 0.0, sun: C(0xa9c2ff), si: 0.32, hs: C(0x5068a8), hg: C(0x1d2430), hi: 0.56, cl: C(0x1b243a), st: 1.0 },
    { el: -8,  top: C(0x0a1634), hor: C(0x2a3462), glow: C(0x8a4760), gk: 0.45, sun: C(0xa9c2ff), si: 0.2, hs: C(0x566aa6), hg: C(0x22262e), hi: 0.52, cl: C(0x2c3454), st: 0.75 },
    { el: -2,  top: C(0x1f3d78), hor: C(0xe8804a), glow: C(0xff5e2a), gk: 1.0, sun: C(0xff6f33), si: 0.18, hs: C(0x8088b2), hg: C(0x3a3833), hi: 0.5, cl: C(0xc77a78), st: 0.2 },
    { el: 3,   top: C(0x3668bc), hor: C(0xffb870), glow: C(0xff8c38), gk: 0.95, sun: C(0xff9a52), si: 0.6, hs: C(0xa7b4d8), hg: C(0x586647), hi: 0.5, cl: C(0xffc49c), st: 0.0 },
    { el: 12,  top: C(0x3380dc), hor: C(0xf6e2c2), glow: C(0xffd29a), gk: 0.65, sun: C(0xffdcae), si: 0.8, hs: C(0xcbdff8), hg: C(0x65824e), hi: 0.6, cl: C(0xfff4e6), st: 0.0 },
    { el: 32,  top: C(0x2f86e8), hor: C(0xd8ecff), glow: C(0xffe2b8), gk: 0.55, sun: C(0xfff3e0), si: 0.85, hs: C(0xdfefff), hg: C(0x6b8a55), hi: 0.66, cl: C(0xffffff), st: 0.0 }
  ];
  const COLS = ['top', 'hor', 'glow', 'sun', 'hs', 'hg', 'cl'], NUMS = ['gk', 'si', 'hi', 'st'];
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  function sample(el, out) {
    let i = 0;
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
    const a = KEYS[i], b = KEYS[i + 1], f = Math.max(0, Math.min(1, (el - a.el) / (b.el - a.el)));
    for (const k of COLS) out[k].copy(a[k]).lerp(b[k], f);
    for (const k of NUMS) out[k] = a[k] + (b[k] - a[k]) * f;
    return out;
  }
  // Sonnenrichtung: geht im Osten (+x) auf, steht mittags im Süden (+z), geht im Westen unter
  function sunAt(tod, v) {
    const a = (tod - 12) / 12 * Math.PI;
    return v.set(-Math.sin(a), 0.85 * Math.cos(a), 0.53 * Math.cos(a)).normalize();
  }

  // ---------- Tageszeit-Wahl ----------
  const MODES = [
    { id: 'auto', name: 'Tag & Nacht' },
    { id: 'dawn', name: 'Sonnenaufgang', tod: 6.35 },
    { id: 'day', name: 'Tag', tod: 10.8 },
    { id: 'dusk', name: 'Sonnenuntergang', tod: 17.72 },
    { id: 'night', name: 'Nacht', tod: 23.5 }
  ];
  const DAY_MS = 12 * 60 * 1000;
  // Anteil des Tages -> Uhrzeit: Dämmerung läuft langsam, die Nacht schneller
  const PHASE = [[0, 5.2], [0.13, 7.6], [0.60, 16.8], [0.78, 19.2], [1, 29.2]];
  function todFor(mode, nowMs) {
    const m = MODES.find(x => x.id === mode);
    if (m && m.tod != null) return m.tod;
    const p = ((nowMs == null ? Date.now() : nowMs) % DAY_MS) / DAY_MS;
    let i = 0; while (i < PHASE.length - 2 && p > PHASE[i + 1][0]) i++;
    const a = PHASE[i], b = PHASE[i + 1];
    return (a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0])) % 24;
  }
  const clock = (tod) => { const m = Math.floor(tod * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  function create(W) {
    const group = new T.Group();
    const cur = { top: C(0), hor: C(0), glow: C(0), sun: C(0), hs: C(0), hg: C(0), cl: C(0), gk: 0, si: 0, hi: 0, st: 0 };
    const sunDir = new T.Vector3(0, 1, 0), moonDir = new T.Vector3(0.4, 0.6, -0.5).normalize(), lightDir = new T.Vector3(-0.45, 0.62, 0.35).normalize();
    const mat = new T.ShaderMaterial({
      uniforms: {
        top: { value: cur.top }, hor: { value: cur.hor }, glow: { value: cur.glow }, glowK: { value: 0 },
        sun: { value: sunDir }, moon: { value: moonDir }, sunCol: { value: C(0xfff3e0) }, sunVis: { value: 1 }, moonVis: { value: 0 }, stars: { value: 0 }, time: { value: 0 }
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 glow; uniform float glowK; uniform vec3 sun; uniform vec3 moon; uniform vec3 sunCol;
        uniform float sunVis; uniform float moonVis; uniform float stars; uniform float time; varying vec3 vD;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vD);
          float h = max(d.y, 0.0);
          vec3 c = mix(hor, top, pow(h, 0.5));
          // Glut um die Sonne: breit am Horizont, eng um die Scheibe
          float s = max(dot(d, sun), 0.0);
          float band = 1.0 - smoothstep(0.0, 0.5, abs(d.y));
          c = mix(c, glow, clamp(glowK * (pow(s, 3.0) * 0.8 * band + pow(s, 28.0) * 0.55), 0.0, 1.0));
          // Dunst unter dem Horizont
          c = mix(c, hor * 0.82, smoothstep(0.0, -0.1, d.y));
          // Sonne
          c += sunCol * (smoothstep(0.99905, 0.9993, s) + pow(s, 700.0) * 0.5) * sunVis;
          // Sterne
          if (stars > 0.01 && d.y > 0.0) {
            vec3 p = d * 240.0, ip = floor(p);
            float rnd = hash(ip);
            float tw = 0.7 + 0.3 * sin(time * (1.5 + rnd * 4.0) + rnd * 60.0);
            float st = step(0.9962, rnd) * smoothstep(0.42, 0.05, length(fract(p) - 0.5));
            c += vec3(0.9, 0.95, 1.0) * st * tw * stars * (0.45 + 0.55 * hash(ip + 7.0)) * smoothstep(0.02, 0.3, d.y);
          }
          // Mond mit Hof
          float m = max(dot(d, moon), 0.0);
          c += vec3(0.86, 0.91, 1.0) * (smoothstep(0.99935, 0.9996, m) * 0.95 + pow(m, 500.0) * 0.22 + pow(m, 40.0) * 0.05) * moonVis;
          gl_FragColor = vec4(c, 1.0); }`,
      side: T.BackSide, depthWrite: false, fog: false
    });
    const mesh = new T.Mesh(new T.SphereGeometry(2800, 32, 16), mat);
    mesh.renderOrder = -10; group.add(mesh);

    const fog = new T.Fog(0xd8ecff, 260 * W, 1500 * W);
    const hemi = new T.HemisphereLight(0xdfefff, 0x6b8a55, 0.66); group.add(hemi);
    const sun = new T.DirectionalLight(0xfff3e0, 0.85);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 170;
    sun.shadow.bias = -0.0008;
    group.add(sun, sun.target);

    const state = { tod: 12, el: 45, night: 0, lamps: 0, env: 1, tint: C(0xffffff), fog: fog.color, cloud: cur.cl };
    const t0 = performance.now();
    function set(tod) {
      sunAt(tod, sunDir);
      const el = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) * 180 / Math.PI;
      sample(el, cur);
      mat.uniforms.glowK.value = cur.gk; mat.uniforms.stars.value = cur.st;
      mat.uniforms.time.value = (performance.now() - t0) / 1000;
      mat.uniforms.sunCol.value.copy(cur.sun).lerp(WHITE, smooth(4, 30, el) * 0.6);
      mat.uniforms.sunVis.value = smooth(-3, 0.5, el);
      // Mond steht der Sonne gegenüber, aber immer ein Stück über dem Horizont
      moonDir.set(-sunDir.x, Math.max(0.32, -sunDir.y * 0.8), -sunDir.z * 0.7 - 0.25).normalize();
      const moonK = smooth(-3, -9, el);
      mat.uniforms.moonVis.value = moonK;
      // Richtungslicht: tagsüber Sonne, nachts Mond – dazwischen kurz ausblenden, damit die Schatten nicht springen
      const useMoon = el < -4.5;
      lightDir.copy(useMoon ? moonDir : sunDir);
      if (lightDir.y < 0.12) { lightDir.y = 0.12; lightDir.normalize(); }      // sehr flache Sonne: Schatten nicht endlos lang
      sun.color.copy(cur.sun);
      sun.intensity = cur.si * Math.min(1, Math.abs(el + 4.5) / 2.5);
      hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hi;
      fog.color.copy(cur.hor).lerp(cur.top, 0.18);
      state.tod = tod; state.el = el;
      state.night = smooth(0, -8, el);          // 0 = Tag, 1 = dunkel
      state.lamps = smooth(5, -3, el);          // Flutlicht und Scheinwerfer gehen in der Dämmerung an
      state.env = 0.22 + 0.78 * smooth(-6, 8, el);
      // Farbe für Rauch & Co.: was an Licht da ist
      state.tint.copy(cur.hs).multiplyScalar(cur.hi * 1.05).add(tmp.copy(cur.sun).multiplyScalar(sun.intensity * 0.42));
      const lift = 0.3 * state.lamps; state.tint.r += lift; state.tint.g += lift; state.tint.b += lift;      // Flutlicht hellt Rauch auf
      state.tint.r = Math.min(1, state.tint.r); state.tint.g = Math.min(1, state.tint.g); state.tint.b = Math.min(1, state.tint.b);
      return state;
    }
    const tmp = C(0);
    set(10.8);
    return { group, mesh, fog, hemi, sun, lightDir, sunDir, state, set };
  }

  window.Sky = { create, MODES, todFor, clock, DAY_MS };
})();
