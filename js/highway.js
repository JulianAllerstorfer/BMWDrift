/* =====================================================================
   Unendliche Autobahn mit Verkehr
   - zwei Richtungsfahrbahnen mit je 3 Spuren + Standstreifen, Betonleitwand
     in der Mitte, Leitplanken außen; leicht geschwungen, endlos in beide Richtungen
   - die Landschaft wird stückweise (150 m) rund ums Auto gebaut und wieder abgebaut
   - Verkehr: Autos und LKWs mit Abstandsregelung und Spurwechseln, auf der
     Gegenfahrbahn kommt Verkehr entgegen. Man driftet zwischen ihnen durch:
     knapp vorbei gibt Bonuspunkte, ein Unfall kostet die Kette.
   Liefert dieselbe Schnittstelle wie Track.build (S, N, nearest, collide, …),
   dazu update() pro Bild und collideTraffic() pro Physikschritt.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  // Mittellinie z(x): zwei überlagerte, sehr weite Bögen (Radien ab ca. 900 m). Periode 24 km.
  const PER = 24000, N = PER;                     // Abtastung 1 m in x
  const A1 = 55, W1 = 2 * Math.PI / 1600, A2 = 120, W2 = 2 * Math.PI / 4800, PH = 0.7;
  const zc = (x) => A1 * Math.sin(W1 * x) + A2 * Math.sin(W2 * x + PH);
  const dzc = (x) => A1 * W1 * Math.cos(W1 * x) + A2 * W2 * Math.cos(W2 * x + PH);
  const ddzc = (x) => -A1 * W1 * W1 * Math.sin(W1 * x) - A2 * W2 * W2 * Math.sin(W2 * x + PH);
  // Querschnitt (seitlicher Abstand zur Bahnlinie S, + = rechts in Fahrtrichtung +x)
  const HW = 7.5, WALL = 7.75, ROAD = 7.5;
  const LANES = [-5.125, -1.375, 2.375];          // eigene Fahrbahn (fährt nach +x): links, Mitte, rechts
  const MED = -8.25;                              // Mitte der Betonleitwand
  const mir = (l) => 2 * MED - l;                 // Gegenfahrbahn gespiegelt an der Mittelwand
  const ULO = -25.0, UHI = 8.5;                   // Asphalt von/bis (Textur quer)
  const RAIL_R = 7.9, RAIL_L = mir(RAIL_R);       // Leitplanken außen
  const CH = 150;                                 // Länge eines Landschaftsstücks
  const AHEAD = 1500, BEHIND = 420;               // gebaut wird von BEHIND hinter bis AHEAD vor dem Auto
  const T_AHEAD = 950, T_BEHIND = 320;            // Verkehr: so weit vor / hinter dem Auto
  const LOD_D = 170;                              // ab hier nur noch ein einfacher Klotz
  const MPS = 1 / 3.6;
  const wrap = (x) => ((x % PER) + PER) % PER;

  function pose(x, lat) {
    const d = dzc(x), l = Math.sqrt(1 + d * d), tx = 1 / l, tz = d / l;
    return { x: x - tz * lat, z: zc(x) + tx * lat, tx, tz, rx: -tz, rz: tx };
  }
  // reproduzierbarer Zufall je Landschaftsstück (wiederholt sich nach einer Periode)
  function rng(seed) { let s = (Math.abs(seed | 0) % 2147483646) + 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  function canvasTex(w, h, draw, rep) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8;
    if (rep) t.repeat.set(rep[0], rep[1]);
    return t;
  }
  function noise(g, w, h, n, c0, c1, sz) {
    for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < 0.5 ? c0 : c1; g.fillRect(Math.random() * w, Math.random() * h, sz, sz); }
  }

  // ---------- Verkehrs-Fahrzeuge vorbereiten: Auto einmal bauen, nach Material zusammenfassen ----------
  // (aus ~300 Einzelteilen werden ~30 Zeichenaufrufe; Geometrie und Material teilen sich alle Kopien)
  // Karosserie-Gitter ausdünnen: jede 2. Spalte, Reihen mit mind. 4,5 cm Abstand; eng beieinander liegende
  // Reihen (Kanten an Radläufen und Fenstern) bleiben, damit die Form scharf bleibt
  function lowIndex(g) {
    if (g.userData._low) return g.userData._low;
    const G = g.userData.grid, xs = G.xs, R = [];
    for (let i = 0; i < G.rows; i++) {
      const edge = (i > 0 && xs[i] - xs[i - 1] < 0.0025) || (i < G.rows - 1 && xs[i + 1] - xs[i] < 0.0025);
      if (i === 0 || i === G.rows - 1 || edge || xs[i] - xs[R[R.length - 1]] >= 0.045) R.push(i);
    }
    const C = []; for (let j = 0; j < G.cols; j += 2) C.push(j);
    const idx = [];
    for (let r = 0; r + 1 < R.length; r++) {
      const o0 = R[r] * G.cols, o1 = R[r + 1] * G.cols;
      for (let c = 0; c < C.length; c++) {
        const j = C[c], j1 = C[(c + 1) % C.length];
        idx.push(o0 + j, o1 + j1, o0 + j1, o0 + j, o1 + j, o1 + j1);
      }
    }
    return (g.userData._low = new Uint32Array(idx));
  }
  function srcIndex(g) {
    if (g.userData.grid) return lowIndex(g);
    if (g.index) return g.index.array;
    const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a;
  }
  function bake(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert();
    const groups = new Map();
    const visible = (o) => { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) break; } return true; };
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || Array.isArray(o.material) || !visible(o)) return;
      const g = o.geometry; if (!g.attributes.position) return;
      let a = groups.get(o.material); if (!a) groups.set(o.material, a = []);
      a.push({ g, m: new T.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
    });
    const out = new T.Group();
    const v = new T.Vector3(), nm = new T.Matrix3();
    for (const [mat, list] of groups) {
      // nur die Punkte übernehmen, die nach dem Ausdünnen noch gebraucht werden
      const parts = list.map(({ g, m }) => {
        const si = srcIndex(g), map = new Int32Array(g.attributes.position.count).fill(-1), used = [];
        for (let i = 0; i < si.length; i++) if (map[si[i]] < 0) { map[si[i]] = used.length; used.push(si[i]); }
        return { g, m, si, map, used };
      });
      let nv = 0, ni = 0;
      for (const q of parts) { nv += q.used.length; ni += q.si.length; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const { g, m, si, map, used } of parts) {
        const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv;
        nm.getNormalMatrix(m);
        for (let k = 0; k < used.length; k++) {
          const i = used[k], o = vo + k;
          v.fromBufferAttribute(P, i).applyMatrix4(m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
          if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z; }
          if (U) { uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i); }
        }
        for (let i = 0; i < si.length; i++) idx[io++] = map[si[i]] + vo;
        vo += used.length;
      }
      const bg = new T.BufferGeometry();
      bg.setAttribute('position', new T.BufferAttribute(pos, 3));
      bg.setAttribute('normal', new T.BufferAttribute(nor, 3));
      bg.setAttribute('uv', new T.BufferAttribute(uv, 2));
      bg.setIndex(new T.BufferAttribute(idx, 1));
      bg.computeBoundingSphere();
      const mesh = new T.Mesh(bg, mat); mesh.castShadow = false; mesh.receiveShadow = false;
      out.add(mesh);
    }
    return out;
  }

  // LKW / Sattelzug (Cartoon): Zugmaschine + Kofferauflieger mit Aufschrift
  function buildTruck(toon, color, label, labelCol) {
    const g = new T.Group();
    const cab = toon(color), dark = toon(0x1d1f23), chrome = toon(0xc9ced4), glass = toon(0x2a3a4c), tire = toon(0x18191c), rim = toon(0x9aa0a6);
    const box = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    // Zugmaschine (vorn bei +x)
    box(2.3, 2.6, 2.45, cab, 6.6, 2.0, 0);                    // Fahrerhaus
    box(0.06, 1.0, 2.1, glass, 7.77, 2.55, 0);                // Frontscheibe
    box(0.08, 0.7, 2.3, dark, 7.78, 1.0, 0);                  // Kühlergrill
    box(0.1, 0.28, 2.4, chrome, 7.8, 0.55, 0);                // Stoßfänger
    box(2.2, 0.5, 2.3, cab, 6.6, 3.55, 0);                    // Dachspoiler
    box(3.4, 0.35, 1.0, dark, 5.2, 0.85, 0);                  // Rahmen
    for (const sd of [1, -1]) { const lamp = box(0.05, 0.16, 0.36, new T.MeshBasicMaterial({ color: 0xfff6e0 }), 7.82, 1.0, sd * 0.85); void lamp; }
    // Auflieger mit Plane / Koffer
    const tt = (() => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const q = c.getContext('2d');
      q.fillStyle = '#' + new T.Color(labelCol[0]).getHexString(); q.fillRect(0, 0, 1024, 256);
      q.fillStyle = '#' + new T.Color(labelCol[1]).getHexString(); q.font = 'italic 900 120px "Arial Black", Arial'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText(label, 512, 136, 980);
      q.fillStyle = 'rgba(0,0,0,0.15)'; for (let i = 0; i < 1024; i += 64) q.fillRect(i, 0, 3, 256);
      return new T.CanvasTexture(c);
    })();
    const side = toon(0xffffff, { map: tt });
    const plain = toon(labelCol[0]);
    const trailer = new T.Mesh(new T.BoxGeometry(13.4, 3.0, 2.5), [plain, plain, plain, plain, side, side]);
    trailer.position.set(-1.6, 2.45, 0); g.add(trailer);
    box(13.2, 0.3, 1.2, dark, -1.6, 0.85, 0);
    // Rückleuchten und Unterfahrschutz
    box(0.06, 0.18, 0.5, new T.MeshBasicMaterial({ color: 0xd8141e }), -8.33, 1.0, 0.9);
    box(0.06, 0.18, 0.5, new T.MeshBasicMaterial({ color: 0xd8141e }), -8.33, 1.0, -0.9);
    box(0.12, 0.15, 2.3, dark, -8.25, 0.55, 0);
    // Räder
    const wg = new T.CylinderGeometry(0.52, 0.52, 0.42, 16); wg.rotateX(Math.PI / 2);
    const rg = new T.CylinderGeometry(0.3, 0.3, 0.44, 12); rg.rotateX(Math.PI / 2);
    for (const x of [6.8, 4.2, 3.0, -5.6, -6.9, -8.0]) for (const sd of [1, -1]) {
      const w = new T.Mesh(wg, tire); w.position.set(x, 0.52, sd * 1.02); g.add(w);
      const r = new T.Mesh(rg, rim); r.position.set(x, 0.52, sd * 1.03); g.add(r);
    }
    return g;
  }

  function build(scene, renderer, mapId) {
    const MAP = window.Track.MAPS[mapId];
    const toon = E46.toon;
    const world = new T.Group(); scene.add(world);

    // ---------- Bahnlinie S (1 m Raster), Fenster wird ums Auto nachgeführt ----------
    const S = new Array(N), X0 = new Float64Array(N);
    {
      let s = 0;
      for (let i = 0; i < N; i++) {
        const x = i, d = dzc(x), l = Math.sqrt(1 + d * d), dd = ddzc(x);
        if (i) s += l;
        S[i] = { x, z: zc(x), y: 0, s, tx: 1 / l, tz: d / l, rx: -d / l, rz: 1 / l, k: -dd / Math.pow(1 + d * d, 1.5) };
        X0[i] = x;
      }
    }
    const LEN = S[N - 1].s + Math.sqrt(1 + dzc(0) * dzc(0));
    let winC = 0;
    function recenter(cx) {
      winC = cx;
      for (let i = 0; i < N; i++) S[i].x = X0[i] + PER * Math.round((cx - X0[i]) / PER);
    }
    recenter(0);
    // nächster Punkt auf der Bahnlinie (analytisch über x, dann zwei Newton-Schritte)
    function nearest(x, z) {
      let xx = x;
      for (let k = 0; k < 3; k++) { const p = pose(xx, 0), lon = (x - p.x) * p.tx + (z - p.z) * p.tz; xx += lon * p.tx; }
      return Math.round(wrap(xx)) % N;
    }
    function latOf(x, z) {
      let xx = x;
      for (let k = 0; k < 3; k++) { const p = pose(xx, 0), lon = (x - p.x) * p.tx + (z - p.z) * p.tz; xx += lon * p.tx; }
      const p = pose(xx, 0);
      return { xs: xx, lat: (x - p.x) * p.rx + (z - p.z) * p.rz, p };
    }
    function sdMain(x, z) {
      const r = latOf(x, z), d = Math.abs(r.lat) - HW, sg = Math.sign(r.lat || 1);
      return { d, gx: r.p.rx * sg, gz: r.p.rz * sg, i: Math.round(wrap(r.xs)) % N, lat: r.lat };
    }

    // ---------- Himmel & Licht ----------
    const sky = Sky.create(1.4);
    world.add(sky.group);
    scene.fog = sky.fog; sky.fog.near = 320; sky.fog.far = 1450;
    const sunL = sky.sun, sunDir = sky.lightDir;

    // ---------- Materialien / Texturen ----------
    const roadTex = canvasTex(1024, 256, (g, w, h) => {
      const U = (lat) => (lat - ULO) / (UHI - ULO) * w;
      g.fillStyle = '#4a4d52'; g.fillRect(0, 0, w, h);
      noise(g, w, h, 16000, '#43464b', '#55585d', 2);
      noise(g, w, h, 3000, '#3b3e42', '#5e6166', 1);
      // Spurrinnen (dunkler) in allen Spuren
      const lanesAll = LANES.concat(LANES.map(mir));
      for (const l of lanesAll) for (const o of [-0.85, 0.85]) {
        const x = U(l + o), bw = 14; const gr = g.createLinearGradient(x - bw, 0, x + bw, 0);
        gr.addColorStop(0, 'rgba(25,26,29,0)'); gr.addColorStop(0.5, 'rgba(25,26,29,0.28)'); gr.addColorStop(1, 'rgba(25,26,29,0)'); g.fillStyle = gr; g.fillRect(x - bw, 0, bw * 2, h);
      }
      // Mittelstreifen unter der Betonleitwand
      g.fillStyle = '#8d8f8e'; g.fillRect(U(MED - 0.9), 0, U(MED + 0.9) - U(MED - 0.9), h);
      noise(g, U(MED + 0.9) - U(MED - 0.9), h, 400, '#828483', '#999b9a', 2);
      // Markierung: durchgehende Randlinien, Leitlinien 6 m Strich / 12 m Lücke (Textur = 18 m)
      const line = (lat, wd, dash) => { g.fillStyle = '#f2f2ef'; const x0 = U(lat - wd / 2), x1 = U(lat + wd / 2); if (dash) g.fillRect(x0, 0, Math.max(2, x1 - x0), h / 3); else g.fillRect(x0, 0, Math.max(2, x1 - x0), h); };
      for (const sd of [1, -1]) {
        const m = (l) => sd > 0 ? l : mir(l);
        line(m(-7.0), 0.25, false); line(m(4.25), 0.3, false);
        line(m(-3.25), 0.16, true); line(m(0.5), 0.16, true);
      }
    });
    roadTex.wrapS = T.ClampToEdgeWrapping;
    const roadMat = toon(0xffffff, { map: roadTex, side: T.FrontSide });
    const grassTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#6fa94a'; g.fillRect(0, 0, w, h);
      noise(g, w, h, 3200, '#659d43', '#84bd5c', 3);
      noise(g, w, h, 900, '#5a9140', '#93c866', 2);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 3 ? 'rgba(60,120,45,0.22)' : 'rgba(150,170,70,0.16)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 14 + Math.random() * 30, 0, 7); g.fill(); }
    });
    const concMat = toon(0xb5b6b2, { side: T.DoubleSide });
    const concDark = toon(0x8e908d, { side: T.DoubleSide });
    const railTex = canvasTex(256, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#5b5f63'; for (const x of [10, 138]) g.fillRect(x, 0, 12, h);
      const gr = g.createLinearGradient(0, 14, 0, 40); gr.addColorStop(0, '#e3e6e8'); gr.addColorStop(0.35, '#9aa0a5'); gr.addColorStop(0.6, '#d5d9dc'); gr.addColorStop(1, '#7d8388');
      g.fillStyle = gr; g.fillRect(0, 14, w, 26);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 26, w, 2);
      g.fillStyle = '#f4f4f2'; g.fillRect(232, 0, 10, h); g.fillStyle = '#1a1a1a'; g.fillRect(232, 6, 10, 9); g.fillStyle = '#ff9a1a'; g.fillRect(234, 8, 6, 5);
    });
    const railMat = toon(0xffffff, { map: railTex, transparent: true, alphaTest: 0.5, side: T.DoubleSide });
    const noiseWallTex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#5f8a5a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 ? '#567f51' : '#6b9665'; g.fillRect(x, 0, 6, h); }
      g.fillStyle = '#8a8d8f'; g.fillRect(0, 0, 6, h); g.fillRect(w / 2, 0, 6, h); g.fillRect(0, h - 10, w, 10);
    });
    const noiseWallMat = toon(0xffffff, { map: noiseWallTex, side: T.DoubleSide });
    const trunkMat = toon(0x6b4a2f), leafMats = [toon(0x3f7d34), toon(0x4c8f3a), toon(0x2f6a2d), toon(0x5c9a3f)];
    const poleMat = toon(0x9da3aa), signBlue = toon(0x1f4fa8);

    // ---------- Boden (folgt dem Auto, Textur bleibt in Weltkoordinaten) ----------
    const GSZ = 3600, GREP = GSZ / 26;
    grassTex.repeat.set(GREP, GREP);
    const ground = new T.Mesh(new T.PlaneGeometry(GSZ, GSZ), toon(0xffffff, { map: grassTex, side: T.FrontSide }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; world.add(ground);

    // Wolken (fliegen mit)
    const clouds = new T.Group(); let cloudMat = null;
    {
      const cm = new T.MeshToonMaterial({ color: 0xffffff, gradientMap: E46.GRAD, emissive: 0x8a9bb0, fog: false });
      cloudMat = cm;
      const sg = new T.SphereGeometry(1, 12, 8);
      for (let i = 0; i < 22; i++) {
        const c = new T.Group(); const k = 3 + (Math.random() * 4 | 0);
        for (let j = 0; j < k; j++) {
          const s = new T.Mesh(sg, cm); const r = 14 + Math.random() * 16;
          s.scale.set(r * 1.3, r * 0.8, r); s.position.set(j * 18 - k * 9 + Math.random() * 6, Math.random() * 6, Math.random() * 10); c.add(s);
        }
        const a = Math.random() * Math.PI * 2, r = 500 + Math.random() * 900;
        c.position.set(Math.cos(a) * r, 150 + Math.random() * 120, Math.sin(a) * r); c.rotation.y = Math.random() * 3;
        clouds.add(c);
      }
      world.add(clouds);
    }
    // ferne Hügel ringsum (fliegen mit, ohne Nebel leicht bläulich)
    const hills = new T.Group();
    {
      const hm = new T.MeshToonMaterial({ color: 0x7f9fa0, gradientMap: E46.GRAD, fog: false });
      const r0 = rng(77);
      for (let i = 0; i < 46; i++) {
        const a = i / 46 * Math.PI * 2 + r0() * 0.1, r = 2300 + r0() * 250, h = 90 + r0() * 220, w = 260 + r0() * 380;
        const m = new T.Mesh(new T.ConeGeometry(w, h, 7, 1), hm); m.position.set(Math.cos(a) * r, h / 2 - 25, Math.sin(a) * r); m.rotation.y = r0() * 3; hills.add(m);
      }
      world.add(hills);
    }

    // ---------- Landschaftsstücke ----------
    function strip(xs, f, mat, along) {
      // f(x) -> Liste von Querschnittspunkten [lat, y, u, Texturlänge]; verbindet sie zu einem Band entlang xs
      // along: Textur läuft in Längsrichtung (Leitplanke, Wand), sonst quer (Fahrbahn)
      const pos = [], uv = [], idx = []; let m = 0;
      for (let i = 0; i < xs.length; i++) {
        const prof = f(xs[i]); m = prof.length;
        for (let j = 0; j < m; j++) {
          const p = pose(xs[i], prof[j][0]), q = prof[j][2] != null ? prof[j][2] : j / (m - 1), l = xs[i] / (prof[j][3] || 18);
          pos.push(p.x, prof[j][1], p.z); if (along) uv.push(l, q); else uv.push(q, l);
        }
        if (i) for (let j = 0; j + 1 < m; j++) { const a = (i - 1) * m + j, b = a + 1, c = i * m + j, d = c + 1; idx.push(a, b, c, b, d, c); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return new T.Mesh(g, mat);
    }
    const signTexCache = new Map();
    function signTex(lines) {
      const key = lines.join('|'); if (signTexCache.has(key)) return signTexCache.get(key);
      const t = canvasTex(512, 256, (g, w, h) => {
        g.fillStyle = '#1f4fa8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
        lines.forEach((ln, i) => { g.font = (i ? 'bold 46px' : 'bold 54px') + ' Arial'; g.fillText(ln, 34, 70 + i * 66, w - 70); });
      });
      t.wrapS = t.wrapT = T.ClampToEdgeWrapping; signTexCache.set(key, t); return t;
    }
    const TOWNS = [['Drift-Autobahn', 'Wien 142 km', 'Linz 38 km'], ['Ausfahrt Querstehen', '↗ Seitwärts 2 km'], ['A1 Richtung Driftland', 'Kurvenlos 18 km'], ['Salzburg 96 km', 'München 230 km'], ['Rasthof Gummiabrieb', '3000 m'], ['Grieskirchen 12 km', 'Wels 24 km']];
    const chunks = new Map();
    const treeGeoT = new T.CylinderGeometry(0.22, 0.32, 2.4, 6), treeGeoC = new T.ConeGeometry(2.2, 6.5, 7), treeGeoS = new T.IcosahedronGeometry(2.6, 0);
    const lodGeo = new T.BoxGeometry(1, 1, 1);
    for (const gg of [treeGeoT, treeGeoC, treeGeoS, lodGeo]) gg.userData.shared = true;
    function buildChunk(ci) {
      const g = new T.Group(), x0 = ci * CH, x1 = x0 + CH, xs = [];
      for (let x = x0; x <= x1 + 0.01; x += 3) xs.push(x);
      const cw = ((ci % (PER / CH)) + PER / CH) % (PER / CH), R = rng(cw * 7919 + 13);
      // Fahrbahn (beide Richtungen in einer Textur)
      const road = strip(xs, () => [[ULO, 0.02, 0], [UHI, 0.02, 1]], roadMat); road.receiveShadow = true; g.add(road);
      // Betonleitwand (New-Jersey-Profil)
      const J = [[-0.32, 0], [-0.24, 0.08], [-0.13, 0.33], [-0.1, 0.92], [0.1, 0.92], [0.13, 0.33], [0.24, 0.08], [0.32, 0]];
      const bar = strip(xs, () => J.map(p => [MED + p[0], p[1]]), concMat); bar.castShadow = true; bar.receiveShadow = true; g.add(bar);
      // Leitplanken außen
      for (const L of [RAIL_R, RAIL_L]) g.add(strip(xs, () => [[L, 0.0, 0, 16], [L, 0.95, 1, 16]], railMat, true));
      // Lärmschutzwand in manchen Abschnitten
      const nwR = cw % 23 >= 4 && cw % 23 <= 8, nwL = cw % 29 >= 15 && cw % 29 <= 18;
      if (nwR) g.add(strip(xs, () => [[12.5, 0, 0, 8], [12.5, 4.2, 1, 8]], noiseWallMat, true));
      if (nwL) g.add(strip(xs, () => [[mir(12.5), 0, 0, 8], [mir(12.5), 4.2, 1, 8]], noiseWallMat, true));
      // Bäume (Nadel- und Laubbäume) neben der Autobahn
      const trees = [];
      for (let k = 0; k < 26; k++) {
        const side = k % 2 ? 1 : -1;
        if ((side > 0 && nwR) || (side < 0 && nwL)) { if (R() < 0.5) continue; }
        const x = x0 + R() * CH, lat = side > 0 ? 15 + R() * R() * 70 : mir(15 + R() * R() * 70), p = pose(x, lat);
        trees.push([p.x, p.z, 0.75 + R() * 0.7, R() < 0.55 ? 0 : 1, (R() * 4) | 0, R() * 6]);
      }
      // r149 prüft die Sichtbarkeit instanzierter Objekte nur mit der Kugel der Einzelgeometrie:
      // deshalb je Stück eine Kopie mit einer Kugel, die das ganze Stück umfasst
      const cpp = pose(x0 + CH / 2, 0), bsph = new T.Sphere(new T.Vector3(cpp.x, 4, cpp.z), CH * 0.5 + 95);
      const geoFor = (base) => { const gg = base.clone(); gg.userData = {}; gg.boundingSphere = bsph.clone(); return gg; };   // clone() kopiert userData mit – die Kopie gehört dem Stück
      if (trees.length) {
        const tr = new T.InstancedMesh(geoFor(treeGeoT), trunkMat, trees.length), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
        for (let i = 0; i < trees.length; i++) { const t = trees[i]; sc.set(t[2], t[2], t[2]); ps.set(t[0], 1.2 * t[2], t[1]); m4.compose(ps, q, sc); tr.setMatrixAt(i, m4); }
        g.add(tr);
        for (let ty = 0; ty < 2; ty++) for (let mi = 0; mi < 4; mi++) {
          const sel = trees.filter(t => t[3] === ty && t[4] === mi); if (!sel.length) continue;
          const im = new T.InstancedMesh(geoFor(ty ? treeGeoS : treeGeoC), leafMats[mi], sel.length);
          for (let i = 0; i < sel.length; i++) { const t = sel[i]; sc.set(t[2], t[2] * (ty ? 1.1 : 1), t[2]); q.setFromAxisAngle(new T.Vector3(0, 1, 0), t[5]); ps.set(t[0], (ty ? 5.0 : 5.4) * t[2], t[1]); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); }
          im.castShadow = true; g.add(im);
        }
      }
      // Schilderbrücke über der eigenen Fahrbahn (alle 1,2 km) bzw. über der Gegenfahrbahn
      if (cw % 8 === 3 || cw % 8 === 7) {
        const own = cw % 8 === 3, xm = x0 + CH * 0.5, pp = pose(xm, 0), hd = Math.atan2(-pp.tz, pp.tx);
        const sg = new T.Group(); sg.position.set(pp.x, 0, pp.z); sg.rotation.y = hd; g.add(sg);
        const la = own ? RAIL_R + 0.9 : RAIL_L - 0.9, lb = MED;   // Stützen außen und auf der Mittelwand
        for (const l of [la, lb]) { const po = new T.Mesh(new T.BoxGeometry(0.4, 7.2, 0.4), poleMat); po.position.set(0, 3.6, l); po.castShadow = true; sg.add(po); }
        const span = Math.abs(la - lb), mid = (la + lb) / 2;
        const beam = new T.Mesh(new T.BoxGeometry(0.5, 0.5, span), poleMat); beam.position.set(0, 6.9, mid); sg.add(beam);
        const beam2 = beam.clone(); beam2.position.y = 5.5; sg.add(beam2);
        const lines = TOWNS[(cw >> 3) % TOWNS.length];
        // Schild zeigt zum Verkehr: eigene Fahrbahn kommt von -x, Gegenfahrbahn von +x
        const face = own ? -1 : 1;
        const pl = new T.Mesh(new T.PlaneGeometry(7.5, 3.0), new T.MeshBasicMaterial({ map: signTex(lines) }));
        pl.position.set(face * 0.32, 6.2, own ? -1.5 : mir(-1.5)); pl.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2; sg.add(pl);
        const back = new T.Mesh(new T.BoxGeometry(0.25, 3.1, 7.6), signBlue); back.position.set(face * 0.15, 6.2, own ? -1.5 : mir(-1.5)); sg.add(back);
      }
      // Überführung (alle 3,6 km): Brücke quer über beide Fahrbahnen
      if (cw % 24 === 12) {
        const xm = x0 + CH * 0.5, pp = pose(xm, 0), hd = Math.atan2(-pp.tz, pp.tx);
        const bg = new T.Group(); bg.position.set(pp.x, 0, pp.z); bg.rotation.y = hd; g.add(bg);
        const l0 = mir(14), l1 = 14, w = (l1 - l0) + 12, mid = (l0 + l1) / 2;
        const deck = new T.Mesh(new T.BoxGeometry(11, 1.3, w), concMat); deck.position.set(0, 6.85, mid); deck.castShadow = true; deck.receiveShadow = true; bg.add(deck);
        const edge = new T.Mesh(new T.BoxGeometry(11.4, 0.5, w), concDark); edge.position.set(0, 7.75, mid); bg.add(edge);
        for (const sd of [1, -1]) { const rl = new T.Mesh(new T.BoxGeometry(0.15, 1.1, w), poleMat); rl.position.set(sd * 5.4, 8.5, mid); bg.add(rl); }
        for (const l of [l1 - 1.0, MED, l0 + 1.0]) for (const sx of [-3.2, 3.2]) {
          const pr = new T.Mesh(new T.BoxGeometry(1.0, 6.2, l === MED ? 0.55 : 1.2), concMat); pr.position.set(sx, 3.1, l); pr.castShadow = true; bg.add(pr);
        }
        // Böschungen / Widerlager an den Enden
        for (const l of [l1 + 4.5, l0 - 4.5]) { const ab = new T.Mesh(new T.BoxGeometry(14, 7.5, 9), toon(0x7f9a5a)); ab.position.set(0, 3.0, l); bg.add(ab); }
      }
      world.add(g);
      return g;
    }
    function disposeChunk(g) {
      world.remove(g);
      g.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    }
    let chunkDir = 1;
    function streamChunks(cx, dir, all) {
      const a = Math.floor((cx - (dir > 0 ? BEHIND : AHEAD)) / CH), b = Math.floor((cx + (dir > 0 ? AHEAD : BEHIND)) / CH);
      for (const [ci, g] of chunks) if (ci < a - 1 || ci > b + 1) { disposeChunk(g); chunks.delete(ci); }
      // pro Bild höchstens zwei neue Stücke bauen (nah zuerst), außer beim ersten Aufbau
      const want = [];
      for (let ci = a; ci <= b; ci++) if (!chunks.has(ci)) want.push(ci);
      want.sort((p, q) => Math.abs((p + 0.5) * CH - cx) - Math.abs((q + 0.5) * CH - cx));
      for (let k = 0; k < want.length && (all || k < 2); k++) chunks.set(want[k], buildChunk(want[k]));
    }

    // ---------- Verkehr ----------
    const PAINT_POOL = [0xf1f2ee, 0xa9adb3, 0x1b1d22, 0xb5121b, 0x1e3a6b, 0x2044a8, 0x5d6168, 0xe7e2d6, 0x2f5d3a, 0x6b1f2b, 0xd9d9d9, 0x23272d];
    const CAR_TYPES = ['e46', 'f31', 'g31', 'f21', 'polo', 'focus', 'fusion', 'e60'].filter(m => window.CAR_MODELS[m]);
    const templates = [];          // { obj, len, wid, h, truck, mass, src }
    function makeTemplates() {
      let pi = 0;
      for (let k = 0; k < CAR_TYPES.length * 2; k++) {
        const model = CAR_TYPES[k % CAR_TYPES.length], paint = PAINT_POOL[(pi++ * 5) % PAINT_POOL.length];
        try {
          const c = E46.create({ model, paint, rimStyle: (k * 3) % 7, rimColor: 0xc9ced4, drop: 0.02, camber: 0, track: 0, plate: 'W-' + (1000 + k * 377) % 9000 });
          c.setLook && c.setLook(E46.lookFromCfg({ tint: 45, spoiler: 0, lip: false, tow: false }));
          c.setWheelOpts && c.setWheelOpts({ lip: null });
          c.update && c.update({ frontSpin: 0, rearSpin: 0, steer: 0, roll: 0, pitch: 0 });
          const obj = bake(c.root), d = c.dims || {};
          const xf = d.XF != null ? d.XF : 2.3, xr = d.XR != null ? d.XR : -2.3;
          templates.push({ obj, len: xf - xr, cx: (xf + xr) / 2, wid: 1.85, truck: false, mass: 1500, xf, xr, src: c, paint });
        } catch (e) { /* Modell fehlt – überspringen */ }
      }
      const TL = [['DRIFT-LOGISTIK', [0xffffff, 0x1c69d4]], ['ZIPFER', [0x1f6d32, 0xffffff]], ['GUMMI & RAUCH', [0xf2c21b, 0x1a1a1a]], ['SPEDITION SEITWÄRTS', [0xd32b2b, 0xffffff]], ['BERGLAND MILCH', [0xffffff, 0x2c5aa0]]];
      const CAB = [0xd32b2b, 0xffffff, 0x1f4fa8, 0xf2c21b, 0x2f2f33];
      for (let k = 0; k < TL.length; k++) {
        const obj = bake(buildTruck(toon, CAB[k % CAB.length], TL[k][0], TL[k][1]));
        templates.push({ obj, len: 16.6, cx: -0.4, wid: 2.5, truck: true, mass: 16000, xf: 7.9, xr: -8.35 });
      }
    }
    makeTemplates();
    const carTpl = templates.filter(t => !t.truck), truckTpl = templates.filter(t => t.truck);
    // Leuchten für die Nacht (geteilte Materialien: einmal pro Bild die Helligkeit setzen)
    const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    glowTex.wrapS = glowTex.wrapT = T.ClampToEdgeWrapping;
    const headGlow = new T.SpriteMaterial({ map: glowTex, color: 0xfff1d8, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    const tailGlow = new T.SpriteMaterial({ map: glowTex, color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    const brakeGlow = new T.SpriteMaterial({ map: glowTex, color: 0xff2a1a, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending });
    // einfacher Klotz für große Entfernung (spart Zeichenaufrufe)
    const lodMats = new Map();
    const lodMat = (hex) => { if (!lodMats.has(hex)) lodMats.set(hex, toon(hex)); return lodMats.get(hex); };

    const veh = [];
    const pool = [];
    function makeVehicle(tpl, dir, lane, x, v) {
      let o = pool.findIndex(p => p.tpl === tpl);
      let node;
      if (o >= 0) { node = pool.splice(o, 1)[0]; }
      else {
        const root = new T.Group();
        const full = tpl.obj.clone(); root.add(full);
        const lod = new T.Group();
        const body = new T.Mesh(lodGeo, lodMat(tpl.truck ? 0xe8e8e8 : tpl.paint));
        body.scale.set(tpl.len, tpl.truck ? 3.2 : 1.05, tpl.wid); body.position.set(tpl.cx, tpl.truck ? 2.2 : 0.75, 0); lod.add(body);
        if (!tpl.truck) { const cab = new T.Mesh(lodGeo, lodMat(0x2a3440)); cab.scale.set(tpl.len * 0.5, 0.45, tpl.wid * 0.9); cab.position.set(tpl.cx - 0.2, 1.4, 0); lod.add(cab); }
        root.add(lod);
        const hy = tpl.truck ? 1.0 : 0.72, ty = tpl.truck ? 1.0 : 0.88, hz = tpl.truck ? 0.85 : 0.62;
        const lights = [];
        for (const sd of [1, -1]) {
          const h = new T.Sprite(headGlow); h.position.set(tpl.xf + 0.1, hy, sd * hz); h.scale.set(0.9, 0.9, 1); root.add(h);
          const t = new T.Sprite(tailGlow); t.position.set(tpl.xr - 0.1, ty, sd * hz); t.scale.set(0.6, 0.6, 1); root.add(t);
          const b = new T.Sprite(brakeGlow); b.position.set(tpl.xr - 0.12, ty, sd * hz); b.scale.set(0.75, 0.75, 1); b.visible = false; root.add(b);
          lights.push(b);
        }
        node = { tpl, root, full, lod, brakes: lights };
      }
      world.add(node.root);
      const vh = { node, tpl, dir, lane, tgt: lane, lat: dir > 0 ? LANES[lane] : mir(LANES[lane]), x, v, v0: v, a: 0, vl: 0, yawK: 0, hitT: 0, clear: 9, side: 0, passed: false, mass: tpl.mass, brake: 0 };
      veh.push(vh);
      return vh;
    }
    function removeVehicle(i) {
      const vh = veh[i]; world.remove(vh.node.root); pool.push(vh.node); veh.splice(i, 1);
    }
    // Wunschtempo je Spur (km/h): links schnell, rechts gemütlich, LKW 85
    function laneSpeed(lane, truck, R) {
      if (truck) return (82 + R() * 8) * MPS;
      return ([142, 120, 98][lane] + (R() - 0.5) * [26, 18, 16][lane]) * MPS;
    }
    const RT = Math.random;
    function spawn(dir, lane, x) {
      const truck = lane === 2 && RT() < 0.32 && truckTpl.length;
      const tpl = truck ? truckTpl[(RT() * truckTpl.length) | 0] : carTpl[(RT() * carTpl.length) | 0];
      const v = laneSpeed(lane, truck, RT);
      return makeVehicle(tpl, dir, lane, x, v);
    }
    // Lücke in einer Spur: nächstes Fahrzeug vor/hinter x (in Fahrtrichtung)
    function gapInfo(dir, lane, x, self) {
      let ahead = null, da = 1e9, behind = null, db = 1e9;
      for (const o of veh) {
        if (o === self || o.dir !== dir) continue;
        if (o.lane !== lane && o.tgt !== lane) continue;
        const d = (o.x - x) * dir;
        if (d >= 0 && d < da) { da = d; ahead = o; }
        if (d < 0 && -d < db) { db = -d; behind = o; }
      }
      return { ahead, da, behind, db };
    }
    const MEAN_GAP = [130, 100, 115];                 // mittlerer Abstand je Spur (m); Gegenfahrbahn etwas dünner
    const gapMul = (d) => d > 0 ? 1 : 1.35;
    function fillInitial(cx, dir) {
      const a = cx - (dir > 0 ? T_BEHIND : T_AHEAD) + 30, b = cx + (dir > 0 ? T_AHEAD : T_BEHIND) - 30;
      for (const d of [1, -1]) for (let lane = 0; lane < 3; lane++) {
        let x = a + RT() * 40;
        const end = b;
        while (x < end) {
          const near = Math.abs(x - cx) < 45 && d > 0;          // nicht direkt aufs Auto setzen
          if (!near) spawn(d, lane, x);
          x += MEAN_GAP[lane] * gapMul(d) * (0.55 + RT() * 1.1);
        }
      }
    }
    // Spieler als Hindernis in der Spur (damit der Verkehr bremst statt durchzufahren)
    const me = { lat: 99, xs: 0, vlon: 0, ok: false };
    let lampK = 0;
    function updateTraffic(dt, cx, dir, ph) {
      if (ph) {
        const r = latOf(ph.x, ph.z); me.ok = true; me.xs = r.xs; me.lat = r.lat;
        const p = r.p; me.vlon = ph.vx * p.tx + ph.vz * p.tz;
      } else me.ok = false;
      // Bewegen (Abstandsregelung nach dem „Intelligent Driver Model“)
      for (const vh of veh) {
        const L = vh.tpl.len;
        let lead = null, gap = 1e9, dv = 0;
        const g0 = gapInfo(vh.dir, vh.tgt, vh.x, vh);
        if (g0.ahead) { gap = g0.da - (L + g0.ahead.tpl.len) / 2; dv = vh.v - g0.ahead.v; lead = g0.ahead; }
        if (vh.tgt !== vh.lane) { const g1 = gapInfo(vh.dir, vh.lane, vh.x, vh); if (g1.ahead) { const gg = g1.da - (L + g1.ahead.tpl.len) / 2; if (gg < gap) { gap = gg; dv = vh.v - g1.ahead.v; lead = g1.ahead; } } }
        // eigenes Auto vor dem Fahrzeug in derselben Spur?
        if (me.ok && vh.dir > 0 && Math.abs(me.lat - vh.lat) < 2.6) {
          const d = (me.xs - vh.x) * vh.dir - L / 2 - 2.4;
          if (d > -1 && d < gap) { gap = Math.max(0.1, d); dv = vh.v - Math.max(0, me.vlon * vh.dir); lead = me; }
        }
        const s0 = vh.tpl.truck ? 6 : 4, Tg = vh.tpl.truck ? 1.6 : 1.1, am = vh.tpl.truck ? 1.0 : 2.4, bm = 3.0;
        const ss = s0 + Math.max(0, vh.v * Tg + vh.v * dv / (2 * Math.sqrt(am * bm)));
        let acc = am * (1 - Math.pow(vh.v / Math.max(1, vh.v0), 4) - (lead ? Math.pow(ss / Math.max(0.5, gap), 2) : 0));
        acc = Math.max(-9, Math.min(am, acc));
        vh.brake = acc < -1.2 ? 1 : 0;
        vh.v = Math.max(0, vh.v + acc * dt);
        if (vh.hitT > 0) { vh.hitT -= dt; vh.v *= Math.exp(-dt * 0.25); }
        const p = pose(vh.x, vh.lat);
        vh.x += vh.v * dt * vh.dir * p.tx;
        // Spurwechsel: links überholen, wenn vorne einer bummelt; danach wieder rechts rein
        if (!vh.tpl.truck && vh.tgt === vh.lane && vh.hitT <= 0) {
          vh.lcT = (vh.lcT || 0) - dt;
          if (vh.lcT <= 0) {
            vh.lcT = 0.6 + RT() * 0.8;
            const ok = (ln) => { const gi = gapInfo(vh.dir, ln, vh.x, vh); return gi.da > 35 + vh.v * 0.6 && gi.db > 18 + Math.max(0, (gi.behind ? gi.behind.v : 0) - vh.v) * 3 && (!me.ok || vh.dir < 0 || Math.abs((me.xs - vh.x)) > 30 || Math.abs(me.lat - LANES[ln]) > 3); };
            const slow = lead && gap < 70 && (lead === me ? Math.max(0, me.vlon * vh.dir) : lead.v) < vh.v0 - 3;
            if (slow && vh.lane > 0 && ok(vh.lane - 1)) vh.tgt = vh.lane - 1;
            else if (slow && lead === me && vh.lane < 2 && ok(vh.lane + 1)) vh.tgt = vh.lane + 1;   // am stehenden Auto rechts vorbei
            else if (vh.lane < 2 && RT() < 0.25 && (() => { const gi = gapInfo(vh.dir, vh.lane + 1, vh.x, vh); return gi.da > 140 && gi.db > 40; })()) { vh.tgt = vh.lane + 1; vh.v0 = Math.min(vh.v0, laneSpeed(vh.tgt, false, RT) + 8 * MPS); }
          }
        }
        const tl = vh.dir > 0 ? LANES[vh.tgt] : mir(LANES[vh.tgt]);
        if (vh.hitT <= 0) {
          const dl = tl - vh.lat, sp = 1.15;
          const step = Math.sign(dl) * Math.min(Math.abs(dl), sp * dt);
          vh.lat += step; vh.yawK = -step / Math.max(0.5, vh.v * dt) * vh.dir;   // nach rechts (+lat) = Gierwinkel kleiner
          if (Math.abs(dl) < 0.02) { vh.lat = tl; vh.lane = vh.tgt; }
        } else {
          // nach einem Rempler: seitlich weggeschoben, dreht sich etwas, fängt sich wieder
          vh.lat += vh.vl * dt; vh.vl *= Math.exp(-dt * 1.6);
          vh.yawK = -vh.vl / Math.max(2, vh.v) * vh.dir + (vh.spin || 0);
          vh.spin = (vh.spin || 0) * Math.exp(-dt * 1.2);
          const lo = vh.dir > 0 ? -HW + vh.tpl.wid / 2 : mir(HW - vh.tpl.wid / 2), hi = vh.dir > 0 ? HW - vh.tpl.wid / 2 : mir(-HW + vh.tpl.wid / 2);
          vh.lat = Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), vh.lat));
          // nächste Spur suchen
          let bl = 0, bd = 1e9; for (let k = 0; k < 3; k++) { const d = Math.abs((vh.dir > 0 ? LANES[k] : mir(LANES[k])) - vh.lat); if (d < bd) { bd = d; bl = k; } }
          vh.lane = vh.tgt = bl;
        }
      }
      // Fenster pflegen: raus was zu weit weg ist, neue Fahrzeuge an den Rändern
      const lo = cx - (dir > 0 ? T_BEHIND : T_AHEAD) - 60, hi = cx + (dir > 0 ? T_AHEAD : T_BEHIND) + 60;
      for (let i = veh.length - 1; i >= 0; i--) if (veh[i].x < lo || veh[i].x > hi) removeVehicle(i);
      const pv = me.ok ? me.vlon : 0;
      for (const d of [1, -1]) for (let lane = 0; lane < 3; lane++) {
        // Rand, an dem neuer Verkehr ins Bild kommt: vorne, wenn wir schneller sind als der Verkehr (oder er uns entgegenkommt), sonst hinten
        const vLane = laneSpeed(lane, false, () => 0.5) * d;
        const front = (pv - vLane) * dir >= 0;
        const edge = front ? (dir > 0 ? hi - 70 : lo + 70) : (dir > 0 ? lo + 70 : hi - 70);
        const gi = gapInfo(d, lane, edge, null);
        const need = MEAN_GAP[lane] * gapMul(d) * (0.6 + RT() * 0.9);
        if (Math.min(gi.da, gi.db) > need && RT() < dt * 3) {
          // nicht ins Blickfeld direkt neben dem Auto setzen
          spawn(d, lane, edge);
        }
      }
      // Darstellung
      for (const vh of veh) {
        const p = pose(vh.x, vh.lat), r = vh.node.root;
        const yaw = Math.atan2(-p.tz, p.tx) + (vh.dir > 0 ? 0 : Math.PI) + Math.atan(vh.yawK || 0);
        vh.wx = p.x; vh.wz = p.z; vh.h = yaw;
        r.position.set(p.x, 0, p.z); r.rotation.y = yaw;
        const dist = Math.abs(vh.x - cx);
        const far = dist > LOD_D;
        vh.node.full.visible = !far; vh.node.lod.visible = far;
        for (const b of vh.node.brakes) b.visible = vh.brake > 0 && dist < 400;
      }
      headGlow.opacity = 0.85 * lampK; tailGlow.opacity = 0.75 * lampK;
    }

    // Kollision eigenes Auto <-> Verkehr (Kreise entlang des Autos gegen Quader des Fahrzeugs)
    const OFFS = [-1.45, 0, 1.45], RAD = 0.92;
    function collideTraffic(ph) {
      let hit = 0;
      const fx = Math.cos(ph.h), fz = -Math.sin(ph.h);
      const m1 = (window.Physics && Physics.P && Physics.P.mass) || 1450;
      for (const vh of veh) {
        if (vh.wx == null) continue;
        const dx0 = ph.x - vh.wx, dz0 = ph.z - vh.wz, reach = vh.tpl.len / 2 + 4;
        if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
        const gx = Math.cos(vh.h), gz = -Math.sin(vh.h), rx = -gz, rz = gx;     // Fahrzeug-Längs- und Querachse
        const hl = vh.tpl.len / 2, hw = vh.tpl.wid / 2, cxo = vh.tpl.cx;
        const vvx = gx * vh.v, vvz = gz * vh.v;
        for (const a of OFFS) {
          const px = ph.x + fx * a, pz = ph.z + fz * a;
          const lx = (px - vh.wx) * gx + (pz - vh.wz) * gz - cxo, lz = (px - vh.wx) * rx + (pz - vh.wz) * rz;
          const qx = Math.max(-hl, Math.min(hl, lx)), qz = Math.max(-hw, Math.min(hw, lz));
          let nx, nz, pen;
          if (qx === lx && qz === lz) {           // Mittelpunkt im Fahrzeug: zur nächsten Seite hinaus
            const ex = hl - Math.abs(lx), ez = hw - Math.abs(lz);
            if (ex < ez) { nx = Math.sign(lx || 1); nz = 0; pen = ex + RAD; } else { nx = 0; nz = Math.sign(lz || 1); pen = ez + RAD; }
          } else {
            const ddx = lx - qx, ddz = lz - qz, d = Math.hypot(ddx, ddz);
            if (d >= RAD) continue;
            nx = ddx / d; nz = ddz / d; pen = RAD - d;
          }
          const wx = nx * gx + nz * rx, wz = nx * gz + nz * rz;     // Normale in Weltkoordinaten (vom Fahrzeug weg)
          const m2 = vh.mass, k1 = m2 / (m1 + m2), k2 = m1 / (m1 + m2);
          ph.x += wx * pen * k1; ph.z += wz * pen * k1;
          const rel = (ph.vx - vvx) * wx + (ph.vz - vvz) * wz;
          if (rel < 0) {
            const j = -rel * 1.2;
            ph.vx += wx * j * k1; ph.vz += wz * j * k1;
            ph.r *= 0.9;
            // Fahrzeug bekommt den Stoß ab: längs bremst/beschleunigt es, quer wird es weggeschoben und dreht sich
            const dvx = -wx * j * k2, dvz = -wz * j * k2;
            const dl = dvx * gx + dvz * gz, dq = dvx * rx + dvz * rz;
            vh.v = Math.max(0, vh.v + dl);
            vh.vl += dq * (vh.dir > 0 ? 1 : -1) * 1.0;
            vh.spin = (vh.spin || 0) + Math.max(-0.4, Math.min(0.4, -lx * dq * 0.05));
            vh.hitT = Math.max(vh.hitT, 2.5);
            vh.v0 = Math.max(vh.v0 * 0.85, 15);
            hit = Math.max(hit, -rel);
            vh.crashed = true;
          }
        }
      }
      return hit;
    }
    // knapp vorbei: kleinster Abstand während des Vorbeifahrens merken, Ereignis wenn das Fahrzeug passiert ist
    function nearMisses(ph) {
      const ev = [];
      const fx = Math.cos(ph.h), fz = -Math.sin(ph.h);
      for (const vh of veh) {
        if (vh.wx == null) continue;
        const dx = ph.x - vh.wx, dz = ph.z - vh.wz, d2 = dx * dx + dz * dz;
        const gx = Math.cos(vh.h), gz = -Math.sin(vh.h), rx = -gz, rz = gx;
        const lon = dx * gx + dz * gz - vh.tpl.cx;
        const side = Math.sign(lon) || 1;
        if (d2 > 40 * 40) { vh.clear = 9; vh.side = side; vh.crashed = false; continue; }
        // Abstand Auto <-> Quader (über die drei Kreise)
        let c = 9;
        for (const a of OFFS) {
          const px = ph.x + fx * a - vh.wx, pz = ph.z + fz * a - vh.wz;
          const lx = px * gx + pz * gz - vh.tpl.cx, lz = px * rx + pz * rz;
          const qx = Math.max(-vh.tpl.len / 2, Math.min(vh.tpl.len / 2, lx)), qz = Math.max(-vh.tpl.wid / 2, Math.min(vh.tpl.wid / 2, lz));
          c = Math.min(c, Math.hypot(lx - qx, lz - qz) - RAD);
        }
        if (Math.abs(lon) < vh.tpl.len / 2 + 3) vh.clear = Math.min(vh.clear, c);
        if (vh.side && side !== vh.side) {
          if (vh.clear < 1.25 && !vh.crashed) ev.push({ clear: Math.max(0, vh.clear), truck: vh.tpl.truck, oncoming: vh.dir < 0 });
          vh.clear = 9; vh.crashed = false;
        }
        vh.side = side;
      }
      return ev;
    }

    // ---------- Abfragen (wie Track.build) ----------
    function setTime(tod) {
      const st = sky.set(tod);
      if (cloudMat) { cloudMat.color.copy(st.cloud); cloudMat.emissive.copy(st.cloud).multiplyScalar(0.5); }
      lampK = st.lamps;
      hills.children.length && hills.children[0].material.color.copy(st.fog).lerp(new T.Color(0x5a7060), 0.35);
      return st;
    }
    function collide(car, halfL, halfW) {
      const fx = Math.cos(car.h), fz = -Math.sin(car.h), rx = Math.sin(car.h), rz = Math.cos(car.h);
      let hit = 0;
      const ri = sdMain(car.x, car.z);
      car.trackIdx = ri.i; car.lateral = ri.lat;
      for (const [a, b] of [[0, 0], [halfL, halfW], [halfL, -halfW], [-halfL, halfW], [-halfL, -halfW]]) {
        const ox = fx * a + rx * b, oz = fz * a + rz * b;
        const r = sdMain(car.x + ox, car.z + oz);
        if (r.d > 0) {
          car.x -= r.gx * r.d; car.z -= r.gz * r.d;
          const vn = car.vx * r.gx + car.vz * r.gz;
          if (vn > 0) {
            const imp = vn * 1.25;
            car.vx -= r.gx * imp; car.vz -= r.gz * imp;
            car.vx *= 0.93; car.vz *= 0.93;
            const cr = ox * (-r.gz * imp) - oz * (-r.gx * imp);
            car.r += cr * 0.08;
            hit = Math.max(hit, vn);
          }
          car.r *= 0.9;
        }
      }
      return hit;
    }
    // Start: rechte Spur, Spawnplätze auf dem Standstreifen
    const startX = 60, sp0 = pose(startX, LANES[2]);
    const spawns = [];
    for (let k = 0; k < 20; k++) { const p = pose(startX - 30 - k * 9, 5.9); spawns.push({ x: p.x, z: p.z, h: Math.atan2(-p.tz, p.tx) }); }

    // erster Aufbau
    streamChunks(startX, 1, true);
    fillInitial(startX, 1);

    let lastCx = startX;
    function update(dt, x, z, ph, heading) {
      // Fahrtrichtung entlang der Autobahn bestimmt, wo vorn gebaut wird
      const r = latOf(x, z);
      const cx = r.xs;
      if (heading != null) { const p = r.p, c = Math.cos(heading) * p.tx - Math.sin(heading) * p.tz; if (Math.abs(c) > 0.3) chunkDir = c > 0 ? 1 : -1; }
      if (Math.abs(cx - winC) > 1500) recenter(cx);
      // großer Sprung (Teleport): Verkehr neu verteilen
      if (Math.abs(cx - lastCx) > 600) { for (let i = veh.length - 1; i >= 0; i--) removeVehicle(i); streamChunks(cx, chunkDir, true); fillInitial(cx, chunkDir); }
      lastCx = cx;
      streamChunks(cx, chunkDir, false);
      // Himmel, Boden, Wolken, Hügel wandern mit
      sky.mesh.position.set(x, 0, z);
      ground.position.set(Math.round(x / 26) * 26, -0.02, Math.round(z / 26) * 26);
      grassTex.offset.set(ground.position.x / 26 % 1, -ground.position.z / 26 % 1);
      clouds.position.set(x, 0, z); hills.position.set(x, 0, z);
      updateTraffic(dt, cx, chunkDir, ph);
      return ph ? { near: nearMisses(ph) } : { near: [] };
    }
    return {
      id: MAP.id, name: MAP.name, fuel: false, highway: true,
      S, N, len: LEN, sun: sunL, sunDir, sky, setTime, world, clouds, nearest: (x, z) => nearest(x, z), collide,
      start: { x: sp0.x, z: sp0.z, h: Math.atan2(-sp0.tz, sp0.tx) },
      startI: startX + 12,
      crossing: null,
      spawns, ROAD, WALL, groundAt: () => 0, gradeAt: () => 0, ceilAt: () => Infinity, bridge: null, terrainH: null,
      sd: (x, z) => sdMain(x, z).d,
      onLift: () => false, liftCenter: { x: 1e7, z: 1e7 }, setLift: () => {},
      clampCam: () => null, atPump: () => false, inPaddock: () => false,
      mini: { S, pit: [], hall: { x0: 0, x1: 0, z0: 0, z1: 0 }, yard: { x0: 0, x1: 0, z0: 0, z1: 0 }, gas: null, lift: { x0: 0, x1: 0, z0: 0, z1: 0 }, local: true, traffic: veh, pose },
      update, collideTraffic, traffic: veh,
      dispose() {
        for (const [, g] of chunks) disposeChunk(g); chunks.clear();
        for (let i = veh.length - 1; i >= 0; i--) removeVehicle(i);
        scene.remove(world);
        for (const t of templates) { t.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); if (t.src && t.src.dispose) t.src.dispose(); }
        world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        for (const gg of [treeGeoT, treeGeoC, treeGeoS, lodGeo]) gg.dispose();
      }
    };
  }

  window.Highway = { build, LANES, MED };
})();
