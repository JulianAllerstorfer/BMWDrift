/* =====================================================================
   BMW E46 Touring – prozedurales Modell (Cel-Shading / FR-Legends-Look)
   Koordinaten (Fahrzeug-lokal): +X = vorne, +Y = oben, +Z = rechts
   Ursprung: Mitte zwischen den Achsen, auf dem Boden.
   Maße orientiert an der echten E46 Touring (Länge 4,48 m, Breite 1,74 m,
   Höhe ~1,41 m, Radstand 2,725 m).
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;

  // ---------- Hilfsfunktionen ----------------------------------------
  // monotone kubische Interpolation (kein Überschwingen)
  function mono(table) {
    const p = table.slice().sort((a, b) => a[0] - b[0]);
    const n = p.length, m = new Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 0) m[i] = (p[1][1] - p[0][1]) / (p[1][0] - p[0][0]);
      else if (i === n - 1) m[i] = (p[n - 1][1] - p[n - 2][1]) / (p[n - 1][0] - p[n - 2][0]);
      else {
        const d0 = (p[i][1] - p[i - 1][1]) / (p[i][0] - p[i - 1][0]);
        const d1 = (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]);
        m[i] = (d0 * d1 <= 0) ? 0 : (d0 + d1) / 2;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const d = (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]);
      if (d === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d, b = m[i + 1] / d, s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d; m[i + 1] = t * b * d; }
    }
    return function (x) {
      if (x <= p[0][0]) return p[0][1];
      if (x >= p[n - 1][0]) return p[n - 1][1];
      let i = 0; while (x > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] +
        (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    };
  }

  // ---------- Grunddaten (werden je Modell gesetzt) ---------------------
  let S = null;                            // aktuelles Fahrzeug-Datenblatt
  let XF, XR, AXF, AXR, WHEEL_R, ARCH_R, ARCH_CY, GH_F, GH_R;
  let halfW, yBot0, yShoulder, yDeck, roofLine, roofHW;
  function useModel(id) {
    S = (window.CAR_MODELS || {})[id] || window.CAR_MODELS.e46;
    ({ XF, XR, AXF, AXR, wheelR: WHEEL_R, archR: ARCH_R, archCY: ARCH_CY, GH_F, GH_R } = S);
    halfW = mono(S.halfW); yBot0 = mono(S.yBot); yShoulder = mono(S.yShoulder);
    yDeck = mono(S.yDeck); roofLine = mono(S.roofLine); roofHW = mono(S.roofHW);
    secCache.clear();
  }
  const secCache = new Map();

  function archLift(x) {
    let y = 0;
    for (const ax of [AXF, AXR]) {
      const dx = x - ax;
      if (Math.abs(dx) < ARCH_R) y = Math.max(y, ARCH_CY + Math.sqrt(ARCH_R * ARCH_R - dx * dx));
    }
    return y;
  }
  const yBot = (x) => Math.max(yBot0(x), archLift(x));
  const yRoof = (x) => (x > GH_F || x < GH_R) ? yDeck(x) : Math.max(yDeck(x), roofLine(x));

  // ---------- Querschnitt ------------------------------------------------
  const CS = 5; // Samples pro gerundeter Ecke
  function section(x) {
    const ck = Math.round(x * 1e5);
    const cached = secCache.get(ck); if (cached) return cached;
    const res = section0(x);
    if (secCache.size > 20000) secCache.clear();
    secCache.set(ck, res); return res;
  }
  function section0(x) {
    const hb = halfW(x), yb = yBot(x);
    const ys = Math.max(yShoulder(x), yb + 0.035);
    const yd = Math.max(yDeck(x), ys + 0.02);
    const yr = Math.max(yRoof(x), yd);
    const gb = hb - 0.065;
    const rw = Math.min(roofHW(x), gb - 0.005);
    const gh = yr - yd;
    const crown = gh > 0.01 ? 0.025 : 0.03;
    const ctrl = [
      [0, yb],
      [hb - 0.10, yb],
      [hb - 0.012, yb + Math.min(0.035, (ys - yb) * 0.3)],
      [hb + 0.004, yb + 0.5 * (ys - yb)],
      [hb, ys],
      [hb - 0.035, ys + 0.6 * (yd - ys)],
      [gb, yd],
      [gb + (rw - gb) * 0.45 + 0.006 * Math.min(1, gh * 5), yd + gh * 0.5],
      [Math.min(rw + 0.02, gb), yr - Math.min(0.04, gh * 0.3)],
      [rw - 0.05, yr + crown * 0.25],
      [rw * 0.45, yr + crown * 0.85],
      [0, yr + crown]
    ];
    const rad = [0, 0.05, 0.03, 0.12, S.shoulderR || 0.06, 0.04, 0.02, 0.12, 0.035, 0.05, 0.2, 0];
    const pts = [[ctrl[0][0], ctrl[0][1]]];
    const key = [0];
    for (let i = 1; i < ctrl.length - 1; i++) {
      const P = ctrl[i], A = ctrl[i - 1], B = ctrl[i + 1];
      const la = Math.hypot(A[0] - P[0], A[1] - P[1]), lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
      const ra = la > 1e-6 ? Math.min(rad[i], la * 0.45) / la : 0;
      const rb = lb > 1e-6 ? Math.min(rad[i], lb * 0.45) / lb : 0;
      const a = [P[0] + (A[0] - P[0]) * ra, P[1] + (A[1] - P[1]) * ra];
      const b = [P[0] + (B[0] - P[0]) * rb, P[1] + (B[1] - P[1]) * rb];
      for (let s = 0; s < CS; s++) {
        const u = s / (CS - 1), w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        pts.push([w0 * a[0] + w1 * P[0] + w2 * b[0], w0 * a[1] + w1 * P[1] + w2 * b[1]]);
      }
      key[i] = pts.length - 1 - (CS >> 1);
    }
    pts.push([ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]]);
    key[ctrl.length - 1] = pts.length - 1;
    // Oberseite (ab Dachkante/Haubenrand bis Mitte) fein und gleichmäßig auflösen -> scharfe Haubensicken möglich
    {
      const k9 = key[9], top = pts.slice(k9), L = [0];
      for (let i = 1; i < top.length; i++) L.push(L[i - 1] + Math.hypot(top[i][0] - top[i - 1][0], top[i][1] - top[i - 1][1]));
      const K = 48, res = [];
      for (let i = 1, j = 0; i <= K; i++) {
        const tl = L[L.length - 1] * i / K;
        while (j < top.length - 2 && L[j + 1] < tl) j++;
        const f = Math.min(1, (tl - L[j]) / Math.max(1e-9, L[j + 1] - L[j]));
        res.push([top[j][0] + (top[j + 1][0] - top[j][0]) * f, top[j][1] + (top[j + 1][1] - top[j][1]) * f]);
      }
      pts.length = k9 + 1; for (const q of res) pts.push(q);
      key[10] = k9 + Math.round(K * 0.6); key[11] = pts.length - 1;
      // Powerdome: Mittelteil der Haube erhaben, Sicken laufen V-förmig auf die Nieren zu
      const HV = S.hoodV, dh = S.domeH || 0;
      if (dh && HV && x > HV[0] && x < HV[1] + 0.03) {
        const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
        const f = Math.max(0, Math.min(1, (x - HV[0]) / (HV[1] - HV[0]))), zc = HV[2] + (HV[3] - HV[2]) * f;
        const h = dh * sm(HV[0], HV[0] + 0.3, x) * (1 - sm(HV[1] - 0.05, HV[1] + 0.03, x));
        for (let j = k9 + 1; j < pts.length; j++) pts[j][1] += h * (1 - sm(zc - 0.008, zc + 0.016, pts[j][0]));
      }
    }
    // Bogenlänge
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1];
    const t = len.map(l => l / total);
    return { x, pts, key, t, total, yb, yd, yr, hb };
  }

  // t (Umfangsparameter) zu einer Höhe y an der Seitenwand
  function tOfY(sec, y) {
    const a = sec.key[1], b = sec.key[6];
    if (y <= sec.pts[a][1]) return sec.t[a];
    for (let j = a; j < b; j++) {
      const y0 = sec.pts[j][1], y1 = sec.pts[j + 1][1];
      if (y >= y0 && y <= y1) {
        const f = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
        return sec.t[j] + f * (sec.t[j + 1] - sec.t[j]);
      }
    }
    return sec.t[b];
  }
  // z an der Seitenwand für Höhe y
  function sideZ(x, y) {
    const sec = section(x);
    const a = sec.key[1], b = sec.key[8];
    if (y <= sec.pts[a][1]) return sec.pts[a][0];
    for (let j = a; j < b; j++) {
      const y0 = sec.pts[j][1], y1 = sec.pts[j + 1][1];
      if (y >= y0 && y <= y1) {
        const f = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
        return sec.pts[j][0] + f * (sec.pts[j + 1][0] - sec.pts[j][0]);
      }
    }
    return sec.pts[b][0];
  }
  function insideSec(sec, y, z) {
    z = Math.abs(z);
    const p = sec.pts; let ins = false;
    const n = p.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = p[i][0], yi = p[i][1], zj = p[j][0], yj = p[j][1];
      if (((yi > y) !== (yj > y)) && (z < (zj - zi) * (y - yi) / (yj - yi) + zi)) ins = !ins;
    }
    return ins;
  }
  // Punkt auf Front-/Heckfläche: liegt (y,z) außerhalb der Karosserie, wird z nach innen gezogen
  function faceX(y, z, lo, hi) {
    let zz = Math.abs(z);
    for (let k = 0; k < 60 && zz > 0 && !insideSec(section(lo), y, zz); k++) zz -= 0.004;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (insideSec(section(m), y, zz)) lo = m; else hi = m; }
    return lo;
  }
  // Suchbereich: ab einem Schnitt, der sicher innerhalb der Karosserie liegt (Modelle können ihn setzen: faceF / faceR)
  const frontX = (y, z) => faceX(y, z, S.faceF != null ? S.faceF : 1.95, XF + 0.004);
  const rearX = (y, z) => faceX(y, z, S.faceR != null ? S.faceR : -2.15, XR - 0.004);

  // ---------- Toon-Materialien ------------------------------------------
  function toonGradient() {
    const d = new Uint8Array([82, 82, 82, 255, 160, 160, 160, 255, 228, 228, 228, 255]);
    const tx = new T.DataTexture(d, 3, 1, T.RGBAFormat);
    tx.minFilter = T.NearestFilter; tx.magFilter = T.NearestFilter; tx.generateMipmaps = false;
    tx.needsUpdate = true;
    return tx;
  }
  const GRAD = toonGradient();

  function addRim(mat, strength, band) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh) {
      if (prev) prev(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', `
        {
          vec3 Nn = normalize(normal); vec3 Vv = normalize(vViewPosition);
          float ndv = clamp(dot(Nn, Vv), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 3.0);
          outgoingLight += vec3(1.0) * smoothstep(0.35, 0.55, rim) * ${strength.toFixed(3)};
          vec3 R = reflect(-Vv, Nn);
          float bnd = smoothstep(0.08, 0.12, R.y) * (1.0 - smoothstep(0.20, 0.24, R.y));
          outgoingLight += vec3(1.0) * bnd * ${band.toFixed(3)};
        }
        #include <output_fragment>`);
    };
    return mat;
  }
  function toon(color, opts) {
    const m = new T.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD, side: T.DoubleSide }, opts || {}));
    return m;
  }

  // ---------- Realistische Materialien (PBR) ------------------------------
  // Umgebung für Spiegelungen: Himmel, heller Horizont, Boden und weiche Lichtstreifen.
  // Three.js wandelt die CubeTexture selbst in eine PMREM-Map um (unscharfe Spiegelung je nach Rauheit).
  let ENV = null;
  function envMap() {
    if (ENV) return ENV;
    const N = 256, imgs = [];
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d');
      if (f === 2) {                                   // +Y: Himmel von oben
        const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.75);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#dfeaf7'); gr.addColorStop(1, '#9fbbe0');
        g.fillStyle = gr; g.fillRect(0, 0, N, N);
        g.fillStyle = 'rgba(255,255,255,0.95)';        // große Softbox / Sonne
        g.fillRect(N * 0.3, N * 0.18, N * 0.4, N * 0.64);
      } else if (f === 3) {                            // -Y: Asphalt
        g.fillStyle = '#2b2c2e'; g.fillRect(0, 0, N, N);
      } else {                                         // Seiten: Himmel – Horizont – Boden
        const gr = g.createLinearGradient(0, 0, 0, N);
        gr.addColorStop(0, '#9fbbe0'); gr.addColorStop(0.42, '#dbe6f2'); gr.addColorStop(0.5, '#f4f5f2');
        gr.addColorStop(0.505, '#6b6d6c'); gr.addColorStop(0.62, '#434547'); gr.addColorStop(1, '#2b2c2e');
        g.fillStyle = gr; g.fillRect(0, 0, N, N);
        // Lichtstreifen, die als lange Reflexe über Lack und Scheiben laufen
        g.fillStyle = 'rgba(255,255,255,0.9)';
        if (f === 0 || f === 1) g.fillRect(N * 0.12, N * 0.22, N * 0.76, N * 0.07);
        if (f === 4 || f === 5) { g.fillRect(N * 0.2, N * 0.12, N * 0.08, N * 0.3); g.fillRect(N * 0.72, N * 0.12, N * 0.08, N * 0.3); }
        // dunkle Silhouetten (Bäume/Gebäude) am Horizont für Kontrast im Lack
        g.fillStyle = 'rgba(70,82,74,0.75)';
        for (let i = 0; i < 9; i++) { const w = N * (0.06 + ((i * 37 + f * 11) % 7) * 0.012); const h = N * (0.03 + ((i * 13 + f * 5) % 5) * 0.012); g.fillRect(i * N / 9, N * 0.5 - h, w, h); }
      }
      imgs.push(c);
    }
    ENV = new T.CubeTexture(imgs); ENV.needsUpdate = true;
    return ENV;
  }
  // Filmische Belichtungskurve nur für die Autos: helle Lacke brennen nicht aus, Glanzlichter laufen weich aus
  function filmic(m, key) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', `
        { vec3 x = gl_FragColor.rgb * 1.05;
          gl_FragColor.rgb = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        #include <tonemapping_fragment>`);
      // Lack: Klarlack-Spiegelung kräftiger (Himmel/Horizont deutlich in den Flanken sichtbar)
      if (m.clearcoat > 0) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n clearcoatSpecular *= 1.8;');
    };
    m.customProgramCacheKey = () => 'car-' + (key || 'std');
    return m;
  }
  // roughness 0 = spiegelglatt … 1 = matt; metal 0 = Kunststoff/Lack … 1 = Metall
  function real(color, rough, metal, opts) {
    return filmic(new T.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal, envMap: envMap(), envMapIntensity: 0.8, side: T.DoubleSide }, opts || {})));
  }
  function carPaint(color, opts) {
    const m = new T.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.03, envMap: envMap(), envMapIntensity: 0.75, side: T.DoubleSide }, opts || {}));
    return opts && opts.map ? m : filmic(m, 'paint');
  }

  const OUTLINE = new T.ShaderMaterial({
    uniforms: { thickness: { value: 0.011 }, color: { value: new T.Color(0x0b0b0e) } },
    vertexShader: 'uniform float thickness; void main(){ vec3 p = position + normalize(normal) * thickness; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
    side: T.BackSide
  });
  function outline(mesh, thick) {
    if (!outline.cartoon) return new T.Object3D();      // realistischer Look: keine Comic-Umrisse
    const m = thick ? OUTLINE.clone() : OUTLINE;
    if (thick) m.uniforms.thickness.value = thick;
    const o = new T.Mesh(mesh.geometry, m);
    o.position.copy(mesh.position); o.rotation.copy(mesh.rotation); o.scale.copy(mesh.scale);
    o.raycast = () => {};
    return o;
  }

  // ---------- Masken-Textur (Fenster, Spalten, Zierleisten) -------------
  const MASK_W = 2048, MASK_H = 1024;
  const C_TRIM = 'rgb(0,255,0)', C_GLASS = 'rgb(255,0,0)', C_GAP = 'rgb(0,0,255)', C_BODY = 'rgb(0,0,0)';
  const uOfX = (x) => (x - XR) / (XF - XR);

  function buildMask() {
    const cv = document.createElement('canvas');
    cv.width = MASK_W; cv.height = MASK_H;
    const g = cv.getContext('2d');
    g.fillStyle = C_BODY; g.fillRect(0, 0, MASK_W, MASK_H);
    const cols = [];
    for (let c = 0; c < MASK_W; c++) cols.push(section(XR + (c + 0.5) / MASK_W * (XF - XR)));

    function fillT(c, t0, t1, col) {
      if (t1 <= t0) return;
      g.fillStyle = col;
      g.fillRect(c, (1 - t1) * MASK_H, 1, (t1 - t0) * MASK_H);
    }
    function rangesAt(poly, x) {
      const q = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
          const f = (x - a[0]) / (b[0] - a[0]); q.push(a[1] + f * (b[1] - a[1]));
        }
      }
      q.sort((a, b) => a - b);
      const r = []; for (let i = 0; i + 1 < q.length; i += 2) r.push([q[i], q[i + 1]]);
      return r;
    }
    function bbox(poly) { let a = 1e9, b = -1e9; for (const p of poly) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); } return [a, b]; }
    function colRange(x0, x1, fn) {
      const c0 = Math.max(0, Math.floor(uOfX(x0) * MASK_W) - 1), c1 = Math.min(MASK_W - 1, Math.ceil(uOfX(x1) * MASK_W) + 1);
      for (let c = c0; c <= c1; c++) { const s = cols[c]; if (s.x >= x0 && s.x <= x1) fn(c, s); }
    }
    // Polygon in (x, y) auf der unteren Seitenwand
    function sidePoly(poly, col) {
      const [x0, x1] = bbox(poly);
      colRange(x0, x1, (c, s) => { for (const [ya, yb] of rangesAt(poly, s.x)) fillT(c, tOfY(s, ya), tOfY(s, yb), col); });
    }
    // Polygon in (x, s) auf der Fensterflanke, s=0 Gürtellinie, s=1 Dachkante
    function ghPoly(poly, col) {
      const [x0, x1] = bbox(poly);
      colRange(x0, x1, (c, s) => {
        const ta = s.t[s.key[6]], tb = s.t[s.key[8]];
        for (const [qa, qb] of rangesAt(poly, s.x)) fillT(c, ta + qa * (tb - ta), ta + qb * (tb - ta), col);
      });
    }
    function line(pts, w, fn) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy); dx /= L; dy /= L;
        const nx = -dy * w / 2, ny = dx * w / 2, ex = dx * w / 2, ey = dy * w / 2;
        fn([[a[0] - ex + nx, a[1] - ey + ny], [b[0] + ex + nx, b[1] + ey + ny], [b[0] + ex - nx, b[1] + ey - ny], [a[0] - ex - nx, a[1] - ey - ny]]);
      }
    }
    const gapW = 0.0055;

    // Unterboden schwarz
    colRange(XR, XF, (c, s) => fillT(c, 0, s.t[s.key[1]] + 0.002, C_TRIM));

    // --- Fenster (Chromleiste, Schattenlinie schwarz, Glas) ---
    const W = S.win;
    if (W.chrome) ghPoly(W.chrome, 'rgb(255,255,0)');
    ghPoly(W.dlo, C_TRIM);
    for (const gp of W.glass) ghPoly(gp, C_GLASS);
    // Frontscheibe
    colRange(W.ws[0], W.ws[1], (c, s) => {
      const t9 = s.t[s.key[9]];
      fillT(c, t9 + 0.012 / s.total, 1, C_TRIM);
      if (s.x > W.ws[2] && s.x < W.ws[3]) fillT(c, t9 + 0.042 / s.total, 1, C_GLASS);
    });
    // Heckscheibe
    colRange(W.rw[0], W.rw[1], (c, s) => {
      const t9 = s.t[s.key[9]], ins = W.rwInset || 0;   // rwInset: lackierte Säulen neben der Heckscheibe (m)
      fillT(c, t9 + (0.014 + ins) / s.total, 1, C_TRIM);
      if (s.x > W.rw[2] && s.x < W.rw[3]) fillT(c, t9 + (0.045 + ins) / s.total, 1, C_GLASS);
    });

    // --- Spaltmaße ---
    const L = (pts) => line(pts, gapW, (p) => sidePoly(p, C_GAP));
    for (const ln of S.gaps.lines) L(ln);
    if (S.gaps.rearDoor != null) {
      const rr = ARCH_R + 0.04, xr = S.gaps.rearDoor;
      const ph0 = Math.asin(Math.max(-1, Math.min(1, (xr - AXR) / rr))) * 180 / Math.PI;
      const arc = [[xr, 1.03], [xr, ARCH_CY + rr * Math.cos(ph0 * Math.PI / 180)]];
      for (let k = 0; k <= 12; k++) {
        const ph = (ph0 + (90 - ph0) * k / 12) * Math.PI / 180;
        arc.push([AXR + rr * Math.sin(ph), ARCH_CY + rr * Math.cos(ph)]);
      }
      arc.push([AXR + rr, S.gaps.doorBottom]);
      L(arc);
      L([[AXR + rr, S.gaps.doorBottom], [S.gaps.doorFront, S.gaps.doorBottom]]);
    }
    // Motorhaube Fuge
    colRange(S.gaps.hood[0], S.gaps.hood[1], (c, s) => { const tc = s.t[s.key[5]] + 0.004 / s.total; fillT(c, tc - gapW / 2 / s.total, tc + gapW / 2 / s.total, C_GAP); });

    // Charakterlinie (Sicke) entlang der Seite
    {
      const pts = [];
      for (let x = S.charLine[0]; x >= S.charLine[1]; x -= 0.03) pts.push([x, yShoulder(x) - 0.028]);
      line(pts, 0.007, (p) => sidePoly(p, 'rgb(0,0,120)'));
    }
    // untere Sicke (F-/G-Modelle, steigt nach hinten an)
    if (S.swage) line(S.swage, 0.007, (p) => sidePoly(p, 'rgb(0,0,110)'));
    // Haubenlinien (V-Form zu den Nieren)
    const HV = S.hoodV;
    if (!S.domeH) colRange(HV[0], HV[1], (c, s) => {
      const f = (s.x - HV[0]) / (HV[1] - HV[0]), zc = HV[2] + (HV[3] - HV[2]) * f;
      let tc = null;
      for (let j = s.key[8]; j < s.pts.length - 1; j++) {
        const a = s.pts[j], b = s.pts[j + 1];
        if (a[0] >= zc && b[0] <= zc) { const q = (a[0] - zc) / Math.max(1e-6, a[0] - b[0]); tc = s.t[j] + q * (s.t[j + 1] - s.t[j]); break; }
      }
      if (tc != null) fillT(c, tc - 0.0035 / s.total, tc + 0.0035 / s.total, 'rgb(0,0,95)');
    });
    // Seitliche Schutzleiste
    // lackierte Leisten (E46 Facelift): nur die Schattenfuge rundherum
    const trimPoly = (q) => { if (S.stripPaint) line(q.concat([q[0]]), 0.006, (p) => sidePoly(p, C_GAP)); else sidePoly(q, C_TRIM); };
    if (S.molding) trimPoly(S.molding);
    if (S.strip) for (const q of S.strip.sides || []) trimPoly(q);

    const tx = new T.CanvasTexture(cv);
    tx.anisotropy = 8;
    tx.minFilter = T.LinearMipmapLinearFilter;
    tx.magFilter = T.LinearFilter;
    return tx;
  }

  // Karosserie-Material. mode 'body': Lack/Zierleisten (Glas wird ausgespart),
  // mode 'glass': nur die Scheiben, getönt und halbdurchsichtig (Innenraum sichtbar)
  function bodyMaterial(color, mask, mode, shared) {
    const glass = mode === 'glass';
    const m = glass
      ? new T.MeshPhysicalMaterial({ color, map: mask, transparent: true, depthWrite: false, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMap: envMap(), envMapIntensity: 1.4, side: T.DoubleSide })
      : carPaint(color, { map: mask });
    m.userData.u = shared || {
      uGlass: { value: new T.Color(0x0e141b) },
      uTrim: { value: new T.Color(0x121315) },
      uGap: { value: new T.Color(0x050506) },
      uGlassA: { value: 0.82 },
      uWin: { value: new T.Vector4(0, 0, 0, 0) },   // Fahrerscheibe: x0, x1, Gürtellinie, Oberkante (Fahrzeugkoordinaten)
      uWinDown: { value: 0 }                          // 0 = zu, 1 = ganz unten
    };
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, m.userData.u);
      sh.fragmentShader = 'uniform vec3 uGlass; uniform vec3 uTrim; uniform vec3 uGap; uniform float uGlassA; uniform vec4 uWin; uniform float uWinDown; varying vec3 vCarPos;\n' + sh.fragmentShader;
      sh.vertexShader = 'varying vec3 vCarPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCarPos = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 mk = texture2D( map, vUv );
        float chromeAmt = min(mk.r, mk.g);
        mk.r -= chromeAmt; mk.g -= chromeAmt;
        ${glass ? 'if (mk.r < 0.5) discard;' : 'if (mk.r > 0.5) discard;'}
        ${glass ? 'if (uWinDown > 0.001 && vCarPos.z < 0.0 && vCarPos.x > uWin.x && vCarPos.x < uWin.y && vCarPos.y > mix(uWin.w, uWin.z, uWinDown)) discard;' : ''}
        vec3 bc = diffuseColor.rgb;
        bc = mix(bc, uTrim, mk.g);
        bc = mix(bc, bc * 0.25 + uGap, mk.b);
        bc = mix(bc, uGlass, mk.r);
        bc = mix(bc, vec3(0.86, 0.88, 0.9), chromeAmt);
        ${glass ? '' : 'if (!gl_FrontFacing) bc = bc * 0.1 + vec3(0.035);'}
        diffuseColor.rgb = bc;
        ${glass ? 'diffuseColor.a = uGlassA;' : ''}
        float glassAmt = ${glass ? '1.0' : 'mk.r'};
        float trimAmt = mk.g;
        float gapAmt = mk.b;
      `);
      // Rauheit / Metall je nach Bereich: Lack, Gummi-/Kunststoffleisten, Spalte, Chrom
      sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, trimAmt);
        roughnessFactor = mix(roughnessFactor, 0.9, gapAmt);
        roughnessFactor = mix(roughnessFactor, 0.04, glassAmt);
        roughnessFactor = mix(roughnessFactor, 0.12, chromeAmt);
        metalnessFactor = mix(metalnessFactor, 0.0, max(max(trimAmt, gapAmt), glassAmt));
        metalnessFactor = mix(metalnessFactor, 1.0, chromeAmt);
        if (!gl_FrontFacing) { roughnessFactor = 1.0; metalnessFactor = 0.0; }
      `);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat *= (1.0 - max(max(trimAmt, gapAmt), chromeAmt)) * (gl_FrontFacing ? 1.0 : 0.0);
      `);
    };
    return filmic(m, 'body-' + (glass ? 'glass' : 'paint'));
  }

  // ---------- Karosserie-Loft --------------------------------------------
  function buildBodyGeometry() {
    const xs = [];
    const N = 300;
    for (let i = 0; i <= N; i++) xs.push(XR + (XF - XR) * i / N);
    for (let k = 1; k <= 30; k++) { const f = (k / 30) * (k / 30) * 0.16; xs.push(XF - f, XR + f); }
    for (const ax of [AXF, AXR]) {
      for (let k = 0; k <= 48; k++) xs.push(ax + ARCH_R * Math.cos(Math.PI * k / 48));
      xs.push(ax + ARCH_R - 0.0004, ax + ARCH_R + 0.0004, ax - ARCH_R + 0.0004, ax - ARCH_R - 0.0004);
    }
    for (const fx of [GH_F, GH_R]) xs.push(fx - 0.001, fx + 0.001);
    xs.sort((a, b) => a - b);
    const st = [];
    for (const x of xs) if (x >= XR && x <= XF && (!st.length || x - st[st.length - 1] > 0.0003)) st.push(x);

    const secs = st.map(section);
    const M = secs[0].pts.length;         // Punkte je Halbschnitt
    const loopN = 2 * M - 2;              // geschlossene Schleife
    const pos = [], uv = [], idx = [];
    for (const s of secs) {
      const u = uOfX(s.x);
      for (let j = 0; j < M; j++) { pos.push(s.x, s.pts[j][1], s.pts[j][0]); uv.push(u, s.t[j]); }
      for (let j = M - 2; j >= 1; j--) { pos.push(s.x, s.pts[j][1], -s.pts[j][0]); uv.push(u, s.t[j]); }
    }
    for (let i = 0; i < secs.length - 1; i++) {
      const o0 = i * loopN, o1 = (i + 1) * loopN;
      for (let j = 0; j < loopN; j++) {
        const j1 = (j + 1) % loopN;
        const a = o0 + j, b = o0 + j1, c = o1 + j1, d = o1 + j;
        idx.push(a, c, b, a, d, c);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Endkappen (vorn/hinten), flach, Lackfarbe
    const capX = Math.min(1.92, XF - 0.2), capSec = section(capX);
    const capUV = [uOfX(capX), tOfY(capSec, 0.42)];
    function cap(s, front) {
      const p = [], n = [], u = [];
      const loop = [];
      for (let j = 0; j < M; j++) loop.push([s.pts[j][0], s.pts[j][1]]);
      for (let j = M - 2; j >= 1; j--) loop.push([-s.pts[j][0], s.pts[j][1]]);
      let cy = 0; for (const q of loop) cy += q[1]; cy /= loop.length;
      const nx = front ? 1 : -1;
      for (let j = 0; j < loop.length; j++) {
        const A = loop[j], B = loop[(j + 1) % loop.length];
        const tri = front ? [[0, cy], B, A] : [[0, cy], A, B];
        for (const q of tri) { p.push(s.x, q[1], q[0]); n.push(nx, 0, 0); u.push(capUV[0], capUV[1]); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(u, 2));
      return g;
    }
    return { body: geo, capF: cap(secs[secs.length - 1], true), capR: cap(secs[0], false) };
  }

  // ---------- Decal / Anbauteil-Werkzeuge ---------------------------------
  function subdivide(geo, maxLen) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const src = g.attributes.position.array, out = [];
    function rec(a, b, c, d) {
      const lab = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const lbc = Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
      const lca = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const mx = Math.max(lab, lbc, lca);
      if (mx <= maxLen || d > 8) { out.push(...a, ...b, ...c); return; }
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      if (mx === lab) { const m = mid(a, b); rec(a, m, c, d + 1); rec(m, b, c, d + 1); }
      else if (mx === lbc) { const m = mid(b, c); rec(a, b, m, d + 1); rec(a, m, c, d + 1); }
      else { const m = mid(c, a); rec(a, b, m, d + 1); rec(m, b, c, d + 1); }
    }
    for (let i = 0; i < src.length; i += 9) rec([src[i], src[i + 1], src[i + 2]], [src[i + 3], src[i + 4], src[i + 5]], [src[i + 6], src[i + 7], src[i + 8]], 0);
    const ng = new T.BufferGeometry();
    ng.setAttribute('position', new T.Float32BufferAttribute(out, 3));
    return ng;
  }
  function shapeOf(poly) {
    const s = new T.Shape();
    poly.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]));
    s.closePath();
    return s;
  }
  function planarUV(geo) {
    const p = geo.attributes.position.array;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const uv = [];
    for (let i = 0; i < p.length; i += 3) uv.push((p[i] - x0) / (x1 - x0), (p[i + 1] - y0) / (y1 - y0));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  }
  // Geometrie in (laterale z, y, Tiefe) -> auf Front-/Heckfläche gelegt
  function conform(geo, where, off, sideSign) {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const a = p[i], b = p[i + 1], d = p[i + 2];
      if (where === 'F') { p[i] = frontX(b, a) + off + d; p[i + 1] = b; p[i + 2] = a; }
      else if (where === 'R') { p[i] = rearX(b, a) - off - d; p[i + 1] = b; p[i + 2] = a; }
      else { p[i] = a; p[i + 1] = b; p[i + 2] = sideSign * (sideZ(a, b) + off + d); }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    // Front/Heck: Normalen glatt aus der Fläche selbst (sonst wirken spiegelnde Teile facettiert)
    if (where === 'F' || where === 'R') {
      const nrm = geo.attributes.normal.array, cache = new Map();
      for (let i = 0; i < p.length; i += 3) {
        const k = Math.round(p[i + 1] * 2000) + ':' + Math.round(p[i + 2] * 2000);
        let n = cache.get(k);
        if (!n) { n = facePose(where, p[i + 1], p[i + 2], 0, 0.025).n; cache.set(k, n); }
        nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z;
      }
      geo.attributes.normal.needsUpdate = true;
    }
    return geo;
  }
  function flatDecal(poly, where, off, mat, opts) {
    opts = opts || {};
    let g = new T.ShapeGeometry(shapeOf(poly), 1);
    g = subdivide(g, opts.maxLen || 0.03);
    if (opts.uv) planarUV(g);
    conform(g, where, off, opts.side || 1);
    const m = new T.Mesh(g, mat);
    return m;
  }
  function solidDecal(shape, depth, where, off, mat, opts) {
    opts = opts || {};
    let g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: opts.seg || 10 });
    g = subdivide(g, opts.maxLen || 0.035);
    conform(g, where, off, opts.side || 1);
    return new T.Mesh(g, mat);
  }
  function roundRect(z0, z1, y0, y1, r, seg) {
    // r = [unten-innen, unten-außen, oben-außen, oben-innen]
    seg = seg || 6;
    const c = [[z0 + r[0], y0 + r[0], r[0], Math.PI, 1.5 * Math.PI], [z1 - r[1], y0 + r[1], r[1], 1.5 * Math.PI, 2 * Math.PI],
    [z1 - r[2], y1 - r[2], r[2], 0, 0.5 * Math.PI], [z0 + r[3], y1 - r[3], r[3], 0.5 * Math.PI, Math.PI]];
    const pts = [];
    for (const [cx, cy, rr, a0, a1] of c) for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * i / seg; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    return pts;
  }
  const mirror = (poly) => poly.map(p => [-p[0], p[1]]).reverse();
  // Position + Normale auf der Front/Heckfläche
  function facePose(where, y, z, off, eps) {
    const f = where === 'F' ? frontX : rearX, sg = where === 'F' ? 1 : -1;
    const e = eps || 0.01;
    const x0 = f(y, z), xy = f(y + e, z), xz = f(y, z + e);
    const dy = new T.Vector3(xy - x0, e, 0), dz = new T.Vector3(xz - x0, 0, e);
    const n = new T.Vector3().crossVectors(dy, dz).normalize();
    if (n.x * sg < 0) n.negate();
    const p = new T.Vector3(x0, y, z).addScaledVector(n, off);
    return { p, n };
  }
  function orientTo(obj, n) { obj.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n); }

  // ---------- Texturen (Kennzeichen, Logo, Schriftzug) ---------------------
  function plateTexture(text) {
    const c = document.createElement('canvas'); c.width = 520; c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, 520, 112);
    g.fillStyle = '#f4f4f0'; g.fillRect(4, 4, 512, 104);
    g.fillStyle = '#1d3e9e'; g.fillRect(4, 4, 46, 104);
    g.fillStyle = '#ffd400';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.arc(27 + Math.cos(a) * 14, 36 + Math.sin(a) * 14, 2.2, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.fillText('D', 27, 94);
    g.fillStyle = '#111'; g.font = 'bold 76px "DIN Alternate", "Arial Narrow", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 285, 60, 440);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function roundelTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c9ced4'; g.beginPath(); g.arc(128, 128, 128, 0, 7); g.fill();
    g.fillStyle = '#0d0d0f'; g.beginPath(); g.arc(128, 128, 118, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 74, 0, 7); g.fill();
    g.fillStyle = '#1c69d4';
    g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, 74, -Math.PI / 2, 0); g.fill();
    g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, 74, Math.PI / 2, Math.PI); g.fill();
    g.strokeStyle = '#c9ced4'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 75, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const L = 'BMW';
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.55;
      g.save(); g.translate(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); g.rotate(a + Math.PI / 2); g.fillText(L[i], 0, 0); g.restore();
    }
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // Marken-Oval (blau, Chromrand, weißer Schriftzug) für Ford
  function ovalTexture(round) {
    const W = 512, H = round ? 512 : 200, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), cx = W / 2, cy = H / 2;
    if (round) { g.fillStyle = '#c3c8ce'; g.beginPath(); g.arc(cx, cy, 256, 0, 7); g.fill(); g.fillStyle = '#26292e'; g.beginPath(); g.arc(cx, cy, 236, 0, 7); g.fill(); }
    const rx = round ? 220 : 252, ry = round ? 88 : 96;
    const ell = (k) => { g.beginPath(); g.ellipse(cx, cy, rx * k, ry * k, 0, 0, 7); };
    const cr = g.createLinearGradient(0, cy - ry, 0, cy + ry); cr.addColorStop(0, '#f2f4f7'); cr.addColorStop(0.5, '#9aa1a9'); cr.addColorStop(1, '#e6e9ed');
    g.fillStyle = cr; ell(1); g.fill();
    const bl = g.createLinearGradient(0, cy - ry, 0, cy + ry); bl.addColorStop(0, '#2c5bb0'); bl.addColorStop(0.55, '#123a86'); bl.addColorStop(1, '#0b2a66');
    g.fillStyle = bl; ell(0.9); g.fill();
    g.strokeStyle = '#f4f6f8'; g.lineWidth = round ? 5 : 6; ell(0.82); g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 700 ' + Math.round(ry * 1.15) + 'px "Brush Script MT", "Segoe Script", "Snell Roundhand", Georgia, serif';
    g.fillText('Ford', cx, cy + ry * 0.06, rx * 1.25);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  let GLARE_TEX = null;
  function glareTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,250,235,0.9)'); gr.addColorStop(0.45, 'rgba(255,240,210,0.28)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,250,240,0.5)'; g.fillRect(0, 62, 128, 4);   // waagrechter Lichtstreif
    return new T.CanvasTexture(c);
  }
  // Lichthupe: car.headlights = Scheinwerfer-Objekte (Blickrichtung lokal +z)
  function setFlash(car, on) {
    if (!car || !car.headlights || !car.headlights.length) return;
    if (!car._glare) {
      if (!GLARE_TEX) GLARE_TEX = glareTexture();
      const sz = car.glareSize || 0.9;
      car._glare = car.headlights.map(h => {
        const sp = new T.Sprite(new T.SpriteMaterial({ map: GLARE_TEX, color: 0xfff6e6, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending }));
        sp.position.z = 0.05; sp.scale.set(sz, sz, 1); sp.renderOrder = 7; sp.visible = false; h.add(sp); return sp;
      });
    }
    for (const sp of car._glare) sp.visible = !!on;
  }
  // Nacht: Abblendlicht (Blendpunkte an den Scheinwerfern + Lichtkegel auf dem Boden) und schwächere Spiegelungen.
  // k: 0 = Licht aus … 1 = an; env: Faktor für die Himmel-Spiegelung im Lack
  let BEAM_TEX = null;
  function beamTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    for (const [w0, w1, a] of [[20, 62, 0.34], [14, 46, 0.34], [8, 28, 0.4]]) {
      const gr = g.createLinearGradient(0, 0, 256, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.06, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(0.45, 'rgba(255,255,255,' + a * 0.5 + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 64 - w0); g.lineTo(256, 64 - w1); g.lineTo(256, 64 + w1); g.lineTo(0, 64 + w0); g.fill();
    }
    // Ränder oben/unten weich auslaufen lassen
    g.globalCompositeOperation = 'destination-out';
    for (const [y0, y1] of [[0, 30], [128, 98]]) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), 256, 30); }
    return new T.CanvasTexture(c);
  }
  function setNight(car, k, env) {
    if (!car) return;
    if ((car._nk == null || Math.abs(car._nk - k) > 0.01) && car.headlights && car.headlights.length) {
      car._nk = k;
      if (!car._low) {
        if (!GLARE_TEX) GLARE_TEX = glareTexture();
        if (!BEAM_TEX) BEAM_TEX = beamTexture();
        const gs = car.glareSize || 0.9, sz = gs * 0.6;
        car._low = car.headlights.map(h => {
          const sp = new T.Sprite(new T.SpriteMaterial({ map: GLARE_TEX, color: 0xfff1d8, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
          sp.position.z = 0.04; sp.scale.set(sz, sz, 1); sp.renderOrder = 6; sp.visible = false; h.add(sp); return sp;
        });
        const sc = gs < 0.6 ? 0.45 : gs > 1 ? 1.15 : 1, len = 16 * sc, wid = 9 * sc;
        const beam = new T.Mesh(new T.PlaneGeometry(len, wid), new T.MeshBasicMaterial({ map: BEAM_TEX, color: 0xfff0cf, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
        const d = car.dims || {}, fx = d.XF != null ? d.XF : (d.AXF || 1) + 0.5;
        beam.rotation.x = -Math.PI / 2; beam.position.set(fx + len / 2 - 0.4, 0.05, 0); beam.renderOrder = 3; beam.visible = false;
        car.root.add(beam); car._beam = beam;
      }
      for (const sp of car._low) { sp.visible = k > 0.02; sp.material.opacity = 0.8 * k; }
      car._beam.visible = k > 0.02; car._beam.material.opacity = 0.3 * k;
    }
    if (env != null && (car._ek == null || Math.abs(car._ek - env) > 0.015)) {
      car._ek = env;
      const seen = new Set();
      car.root.traverse(o => {
        if (!o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m.envMap || seen.has(m)) continue;
          seen.add(m);
          if (m.userData.envBase == null) m.userData.envBase = m.envMapIntensity;
          m.envMapIntensity = m.userData.envBase * env;
        }
      });
    }
  }
  function badgeTexture(text, w, h, font) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8ecf0'; g.fillText(text, w / 2, h / 2 + 2);
    const t = new T.CanvasTexture(c); return t;
  }

  // ---------- Felgen & Reifen ---------------------------------------------
  const RIMS = [
    { name: 'Deep Dish 6', dish: 0.055 },
    { name: 'Style 68', dish: 0.012 },
    { name: 'Mesh RS', dish: 0.035 },
    { name: 'Turbofan', dish: 0.02 },
    { name: 'M 5-Speiche', dish: 0.015 },
    { name: 'Y-Speiche', dish: 0.018 },
    { name: 'Turbine', dish: 0.02 },
    { name: 'Stahlfelge', dish: 0.03 },
    { name: 'Konkav 10', dish: 0.062 }
  ];
  const RIM_SIZES = [{ name: '16"', r: 0.203 }, { name: '17"', r: 0.216 }, { name: '18"', r: 0.229 }, { name: '19"', r: 0.242 }];
  const LIP_COLORS = [{ name: 'Poliert', hex: 0xd9dde2 }, { name: 'Wie Felge', hex: null }, { name: 'Schwarz', hex: 0x1b1c1f }, { name: 'Gold', hex: 0xc9a33a }, { name: 'Bronze', hex: 0x8a6232 }];
  let ROUNDEL_TEX = null, LETTER_TEX = null, OVAL_TEX = null, OVAL_CAP_TEX = null;
  // weiße Reifenschrift im Kreis (wird auf die Reifenflanke gelegt)
  function letterTexture(rIn, rOut) {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d'), sc = 512 / rOut, rr = (rIn + rOut) / 2 * sc;
    g.translate(512, 512);
    g.fillStyle = '#f4f4f4'; g.font = 'bold ' + Math.round((rOut - rIn) * sc * 0.5) + 'px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = 'DRIFT KING  ·  SEMI SLICK  ·  DRIFT KING  ·  SEMI SLICK  ·  ';
    const step = Math.PI * 2 / txt.length;
    for (let i = 0; i < txt.length; i++) { g.save(); g.rotate(i * step); g.translate(0, -rr); g.fillText(txt[i], 0, 0); g.restore(); }
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  function buildWheel(style, mats, side, opt) {
    opt = opt || {};
    const rimR = opt.rimR || 0.216, k = rimR / 0.216;
    const wheel = new T.Group();           // dreht sich
    // Reifenprofil: Flankenhöhe passt sich der Felgengröße an
    const rb = rimR - 0.002, hs = 0.318 - rb;
    const q = [[0, 0.106], [0.23, 0.113], [0.558, 0.119], [0.808, 0.117], [0.933, 0.109], [0.986, 0.094], [1, 0.04]];
    const tp = [];
    for (const [f, y] of q) tp.push([rb + hs * f, -y]);
    for (let i = q.length - 1; i >= 0; i--) tp.push([rb + hs * q[i][0], q[i][1]]);
    const tg = new T.LatheGeometry(tp.map(p => new T.Vector2(p[0], p[1])), 44);
    tg.rotateX(Math.PI / 2);
    const tire = new T.Mesh(tg, mats.tire);
    wheel.add(tire, outline(tire, 0.008));
    if (opt.letters) {
      const r0 = rb + hs * 0.25, r1 = rb + hs * 0.8;
      const lt = new T.Mesh(new T.RingGeometry(r0, r1, 64), new T.MeshBasicMaterial({ map: letterTexture(r0, r1), transparent: true, depthWrite: false }));
      // planare UVs der Ringgeometrie auf den Außenradius normieren
      const uv = lt.geometry.attributes.uv, ps = lt.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, ps.getX(i) / r1 / 2 + 0.5, ps.getY(i) / r1 / 2 + 0.5);
      lt.position.z = 0.1212; wheel.add(lt);
    }
    const dish = RIMS[style].dish;
    const faceZ = 0.112 - dish;
    // Felgenbett + Lippe
    const lp = [[0.196, -0.10], [0.206, -0.096], [0.206, 0.08], [0.214, 0.100], [0.222, 0.108], [0.222, 0.116], [0.213, 0.119],
      [0.203, 0.113], [0.199, faceZ + 0.01], [0.192, faceZ]];
    const lg = new T.LatheGeometry(lp.map(p => new T.Vector2(p[0] * k, p[1])), 44);
    lg.rotateX(Math.PI / 2);
    wheel.add(new T.Mesh(lg, mats.lip));
    const back = new T.Mesh(new T.CircleGeometry(0.2 * k, 32), mats.dark);
    back.position.z = -0.06; wheel.add(back);
    const disc = new T.Mesh(new T.CylinderGeometry(0.165 * Math.min(k, 1.08), 0.165 * Math.min(k, 1.08), 0.026, 32), mats.disc);
    disc.rotation.x = Math.PI / 2; disc.position.z = -0.02; wheel.add(disc);
    const hat = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.04, 20), mats.dark);
    hat.rotation.x = Math.PI / 2; hat.position.z = -0.0; wheel.add(hat);

    const spokes = new T.Group(); spokes.position.z = faceZ; spokes.scale.set(k, k, 1); wheel.add(spokes);
    const rimMat = mats.rim;
    function spoke(a, w0, w1, r0, r1, th, zoff, mat) {
      const s = new T.Shape();
      s.moveTo(r0, -w0 / 2); s.lineTo(r1, -w1 / 2); s.lineTo(r1, w1 / 2); s.lineTo(r0, w0 / 2); s.closePath();
      const bv = th > 0.012 ? 0.004 : 0;   // abgerundete Kanten, damit die Speichen Licht fangen
      const g = new T.ExtrudeGeometry(s, { depth: th - bv, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: 0.003, bevelOffset: -0.003, bevelSegments: 2 });
      const m = new T.Mesh(g, mat || rimMat); m.rotation.z = a; m.position.z = (zoff || 0) - th; spokes.add(m); return m;
    }
    const TAU = Math.PI * 2;
    if (style === 0) {        // tiefes Bett, 6 breite Speichen
      for (let i = 0; i < 6; i++) spoke(i / 6 * TAU, 0.07, 0.045, 0.05, 0.198, 0.03, 0.004);
    } else if (style === 1) { // BMW Doppelspeiche
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU;
        spoke(a - 0.075, 0.024, 0.02, 0.06, 0.205, 0.028, 0.008);
        spoke(a + 0.075, 0.024, 0.02, 0.06, 0.205, 0.028, 0.008);
      }
    } else if (style === 2) { // Kreuzspeichen-Mesh
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU;
        spoke(a, 0.03, 0.012, 0.055, 0.2, 0.022, 0.004);
        const m1 = spoke(a + 0.31, 0.009, 0.009, 0.08, 0.2, 0.014, 0.0); m1.rotation.z = a + 0.31;
      }
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * TAU;
        const sh = new T.Shape(); sh.moveTo(0, -0.004); sh.lineTo(0.12, -0.004); sh.lineTo(0.12, 0.004); sh.lineTo(0, 0.004); sh.closePath();
        const m = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: false }), rimMat);
        m.position.set(Math.cos(a) * 0.085, Math.sin(a) * 0.085, -0.012);
        m.rotation.z = a + (i % 2 ? 0.55 : -0.55);
        spokes.add(m);
      }
      for (let i = 0; i < 30; i++) {
        const a = i / 30 * TAU;
        const bt = new T.Mesh(new T.SphereGeometry(0.0045, 6, 4), mats.chrome);
        bt.position.set(Math.cos(a) * 0.207, Math.sin(a) * 0.207, dish - 0.003);
        spokes.add(bt);
      }
    } else if (style === 3) { // Turbofan / Scheibe mit Schlitzen
      const ring = new T.Mesh(new T.RingGeometry(0.06, 0.2, 40), rimMat);
      ring.position.z = -0.004; spokes.add(ring);
      for (let i = 0; i < 12; i++) {
        const sh = new T.Shape(); sh.moveTo(0.09, -0.012); sh.lineTo(0.185, -0.022); sh.lineTo(0.185, 0.008); sh.lineTo(0.09, 0.006); sh.closePath();
        const m = new T.Mesh(new T.ShapeGeometry(sh), mats.dark); m.rotation.z = i / 12 * TAU; m.position.z = -0.002; spokes.add(m);
      }
    } else if (style === 4) { // M 5-Speiche mit Mittelnut
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        spoke(a, 0.078, 0.052, 0.05, 0.203, 0.03, 0.006);
        spoke(a, 0.012, 0.008, 0.08, 0.19, 0.004, 0.0075, mats.dark);
      }
    } else if (style === 5) { // Y-Speiche
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        spoke(a, 0.05, 0.04, 0.05, 0.125, 0.028, 0.006);
        for (const sg of [-1, 1]) spoke(a + sg * 0.13, 0.03, 0.022, 0.108, 0.204, 0.026, 0.006);
      }
    } else if (style === 6) { // Turbine: gebogene Speichen
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU;
        for (let j = 0; j < 9; j++) spoke(a + j * 0.045, 0.027, 0.025, 0.055 + j * 0.0165, 0.085 + j * 0.0165, 0.022, 0.004);
      }
    } else if (style === 7) { // Stahlfelge mit Lüftungslöchern
      const disk = new T.Mesh(new T.RingGeometry(0.065, 0.204, 48), rimMat); disk.position.z = -0.002; spokes.add(disk);
      const step = new T.Mesh(new T.RingGeometry(0.165, 0.175, 48), mats.dark); step.position.z = -0.001; spokes.add(step);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        const hole = new T.Mesh(new T.CircleGeometry(0.03, 20), mats.dark); hole.position.set(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.0); spokes.add(hole);
      }
    } else {                  // Konkav 10: Speichen nach innen gewölbt
      for (let i = 0; i < 10; i++) {
        const m = spoke(i / 10 * TAU, 0.032, 0.022, 0.055, 0.205, 0.022, 0.004);
        m.rotation.order = 'ZYX'; m.rotation.y = -0.27;
      }
    }
    // Nabe + Radmuttern + Nabendeckel
    const hub = new T.Mesh(new T.CylinderGeometry(0.068, 0.07, 0.03, 24), rimMat);
    hub.rotation.x = Math.PI / 2; hub.position.z = -0.012; spokes.add(hub);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const nut = new T.Mesh(new T.CylinderGeometry(0.009, 0.009, 0.02, 6), mats.chrome);
      nut.rotation.x = Math.PI / 2; nut.position.set(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.006); spokes.add(nut);
    }
    if (!ROUNDEL_TEX) ROUNDEL_TEX = roundelTexture();
    if (opt.brand === 'ford' && !OVAL_CAP_TEX) OVAL_CAP_TEX = ovalTexture(true);
    const capMat = new T.MeshBasicMaterial({ map: opt.brand === 'ford' ? OVAL_CAP_TEX : ROUNDEL_TEX });
    const cap = new T.Mesh(new T.CircleGeometry(0.028, 24), capMat);
    cap.position.z = 0.012; spokes.add(cap);
    // Spiegeln für linke Seite erfolgt über das Gelenk
    return wheel;
  }

  // ---------- Fahrzeug zusammenbauen ----------------------------------------
  const PAINTS = [
    { name: 'Alpinweiß III', hex: 0xf1f2ee },
    { name: 'Titansilber', hex: 0xa9adb3 },
    { name: 'Saphirschwarz', hex: 0x1b1d22 },
    { name: 'Imolarot II', hex: 0xb5121b },
    { name: 'Topasblau', hex: 0x1e3a6b },
    { name: 'Estorilblau', hex: 0x2044a8 },
    { name: 'Phönixgelb', hex: 0xe6b81d },
    { name: 'Laguna Seca', hex: 0x2f7fd8 },
    { name: 'Stahlgrau', hex: 0x6e747b },
    { name: 'Orientblau', hex: 0x1b2440 },
    { name: 'Mintgrün', hex: 0x7fd9bf },
    { name: 'Hot Pink', hex: 0xe8508f },
    { name: 'Nardograu', hex: 0x8b9096 },
    { name: 'Feuerorange', hex: 0xe8591a },
    { name: 'Britischgrün', hex: 0x1f4a36 },
    { name: 'Technoviolett', hex: 0x4a2a6e },
    { name: 'Dakargelb', hex: 0xf2d21c },
    { name: 'Mitternachtslila', hex: 0x2a1840 }
  ];
  // Lack-Finish: Rauheit, Metall-Anteil, Klarlack
  const FINISHES = [
    { name: 'Glanz', rough: 0.5, metal: 0.05, coat: 1.0, coatRough: 0.03 },
    { name: 'Metallic', rough: 0.34, metal: 0.55, coat: 1.0, coatRough: 0.03 },
    { name: 'Matt', rough: 0.85, metal: 0.05, coat: 0.04, coatRough: 0.95 },      // Klarlack nie ganz 0: der Lack-Shader rechnet immer mit ihm
    { name: 'Satin', rough: 0.55, metal: 0.3, coat: 0.45, coatRough: 0.4 },
    { name: 'Chrom', rough: 0.1, metal: 1.0, coat: 1.0, coatRough: 0.02 }
  ];
  const RIM_COLORS = [
    { name: 'Silber', hex: 0xaab2bc }, { name: 'Gold', hex: 0xc9a33a }, { name: 'Schwarz', hex: 0x1a1b1e },
    { name: 'Weiß', hex: 0xf0f0f0 }, { name: 'Bronze', hex: 0x8a6232 }, { name: 'Rot', hex: 0xc0202a }
  ];

  function create(cfg) {
    cfg = Object.assign({ model: 'e46', paint: 0xf1f2ee, rimStyle: 0, rimColor: 0xc9ced4, drop: 0.06, camber: 5, track: 0.03 }, cfg || {});
    useModel(cfg.model);
    const SP = S;                                   // Datenblatt dieses Autos (S ändert sich beim nächsten create)
    const root = new T.Group(); root.name = SP.id;
    const chassis = new T.Group(); root.add(chassis);   // wird gerollt / genickt
    const bodyG = new T.Group(); chassis.add(bodyG);

    const mask = buildMask();
    const paint = carPaint(cfg.paint);
    const bodyMat = bodyMaterial(cfg.paint, mask);
    const mats = {
      trim: real(0x141517, 0.55, 0),
      dark: real(0x0b0b0c, 0.6, 0),
      chrome: real(0xe4e7ea, 0.08, 1),
      lip: real(0xd9dde2, 0.18, 1),
      rim: real(cfg.rimColor, 0.16, 0.85),
      tire: real(0x161718, 0.88, 0, { envMapIntensity: 0.5 }),
      disc: real(0x8a8d91, 0.42, 1),
      caliper: carPaint(0xc6262a, { metalness: 0.05, roughness: 0.3 }),
      housing: real(0x3a414a, 0.35, 0.7),
      headChrome: real(0xb9c0c8, 0.32, 1),
      headDark: real(0x24282e, 0.45, 0.2),
      lens: real(0x2a3038, 0.03, 0.4, { envMapIntensity: 1.5 }),
      headGlass: filmic(new T.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.02, metalness: 0, envMap: envMap(), envMapIntensity: 2.5, depthWrite: false, side: T.DoubleSide }), 'hg'),
      slat: real(0x202226, 0.4, 0.1),
      reflector: real(0xe3e8ee, 0.1, 1),
      angel: new T.MeshBasicMaterial({ color: 0xf6fbff, side: T.DoubleSide }),
      tail: new T.MeshBasicMaterial({ color: 0xa50e17, side: T.DoubleSide }),
      tailInner: new T.MeshBasicMaterial({ color: 0xd8202a, side: T.DoubleSide }),
      tailDark: new T.MeshBasicMaterial({ color: 0x4a080c, side: T.DoubleSide }),
      tailClear: real(0xc9ccd2, 0.06, 0.6),
      amber: new T.MeshBasicMaterial({ color: 0xf29a1e, side: T.DoubleSide }),
      fog: new T.MeshBasicMaterial({ color: 0xfff6dc, side: T.DoubleSide }),
      glass: real(0x0e141b, 0.04, 0, { envMapIntensity: 1.4 }),
      liner: new T.MeshBasicMaterial({ color: 0x08080a, side: T.DoubleSide }),
      carbon: carPaint(0x1c1e22, { roughness: 0.32, metalness: 0.3 })
    };
    paint.color.setHex(cfg.paint);
    const MR = (p, sd) => sd > 0 ? p : mirror(p);

    // --- Karosserie ---
    const bg = buildBodyGeometry();
    const body = new T.Mesh(bg.body, bodyMat);
    body.castShadow = true;
    bodyG.add(body, outline(body, 0.012));
    const glassMat = bodyMaterial(0xffffff, mask, 'glass', bodyMat.userData.u);
    const glassMesh = new T.Mesh(bg.body, glassMat); glassMesh.renderOrder = 3; bodyG.add(glassMesh);
    bodyG.add(new T.Mesh(bg.capF, bodyMat), new T.Mesh(bg.capR, bodyMat));

    // Radhausschalen
    const lz = SP.trackHalf - 0.105, lw = 0.42;
    for (const ax of [AXF, AXR]) {
      for (const sd of [1, -1]) {
        const lg = new T.CylinderGeometry(ARCH_R - 0.01, ARCH_R - 0.01, lw, 28, 1, true, 0, Math.PI);
        lg.rotateX(Math.PI / 2); lg.rotateZ(Math.PI / 2);
        const lin = new T.Mesh(lg, mats.liner); lin.position.set(ax, ARCH_CY, sd * lz); bodyG.add(lin);
        const disk = new T.Mesh(new T.CircleGeometry(ARCH_R, 28, 0, Math.PI), mats.liner);
        disk.position.set(ax, ARCH_CY, sd * (lz - lw / 2)); bodyG.add(disk);
      }
    }

    // --- Front ---
    const F = new T.Group(); bodyG.add(F);
    const K = SP.kidney;
    if (K) for (const sd of [1, -1]) {
      const fr = 0.013;
      const outer = roundRect(K.z[0], K.z[1], K.y[0], K.y[1], K.r);
      const inner = roundRect(K.z[0] + fr, K.z[1] - fr, K.y[0] + fr, K.y[1] - fr, K.r.map(r => Math.max(0.004, r - fr)));
      const o = MR(outer, sd), ii = MR(inner, sd);
      const sh = shapeOf(o); sh.holes.push(shapeOf(ii.slice().reverse()));
      F.add(solidDecal(sh, 0.026, 'F', -0.006, mats.chrome, { maxLen: 0.03 }));
      F.add(flatDecal(ii, 'F', 0.006, mats.dark, { maxLen: 0.03 }));
      const n = K.slats, w0 = K.z[0] + fr + 0.012, w1 = K.z[1] - fr - 0.012;
      for (let k = 0; k < n; k++) {
        const z = w0 + (w1 - w0) * k / Math.max(1, n - 1), zz = sd * z;
        // Stäbe folgen der Rundung unten außen
        const fo = (z - K.z[0]) / (K.z[1] - K.z[0]);
        const yb = K.y[0] + fr + 0.004 + Math.max(0, fo - 0.6) * K.r[1] * 1.6;
        const bar = roundRect(zz - 0.0032, zz + 0.0032, yb, K.y[1] - fr - 0.005, [0.002, 0.002, 0.002, 0.002], 2);
        F.add(solidDecal(shapeOf(bar), 0.014, 'F', 0.0, mats[K.slatMat], { maxLen: 0.04 }));
      }
    }
    // Kühlergrill (Nicht-BMW): Chromrahmen, dunkles Gitter, waagrechte Stäbe
    if (SP.grille) {
      const G = SP.grille, half = G.poly;
      const full = half.concat(mirror(half).slice(1, -1));
      let y0 = 1e9, y1 = -1e9, zw = 0; for (const p of full) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); zw = Math.max(zw, Math.abs(p[0])); }
      const cy = (y0 + y1) / 2, fr = G.frame || 0.014;
      const inner = full.map(p => [p[0] * (zw - fr) / zw, cy + (p[1] - cy) * ((y1 - y0) / 2 - fr) / ((y1 - y0) / 2)]);
      const sh = shapeOf(full); sh.holes.push(shapeOf(inner.slice().reverse()));
      F.add(solidDecal(sh, 0.022, 'F', -0.006, mats.chrome, { maxLen: 0.025 }));
      F.add(flatDecal(inner, 'F', 0.004, mats.dark, { maxLen: 0.025 }));
      const zAt = (y) => {   // Breite des Gitters auf Höhe y
        const q = []; for (let i = 0; i < inner.length; i++) { const a = inner[i], b = inner[(i + 1) % inner.length]; if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) q.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
        return q.length >= 2 ? [Math.min(...q), Math.max(...q)] : null;
      };
      for (let k = 1; k <= G.bars; k++) {
        const y = y0 + fr + (y1 - y0 - 2 * fr) * k / (G.bars + 1), zr = zAt(y); if (!zr) continue;
        const bar = roundRect(zr[0] + 0.006, zr[1] - 0.006, y - 0.0045, y + 0.0045, [0.003, 0.003, 0.003, 0.003], 2);
        F.add(solidDecal(shapeOf(bar), 0.012, 'F', 0.0, G.barMat === 'chrome' ? mats.chrome : mats.slat, { maxLen: 0.03 }));
      }
    }
    // Marken-Oval vorn / hinten
    const ovalAt = (where, o) => {
      if (!OVAL_TEX) OVAL_TEX = ovalTexture(false);
      const pose = facePose(where, o[0], 0, o[3] || 0.012, 0.02);
      const m = new T.Mesh(new T.PlaneGeometry(o[1], o[2]), new T.MeshBasicMaterial({ map: OVAL_TEX, transparent: true }));
      m.position.copy(pose.p); orientTo(m, pose.n); return m;
    };
    if (SP.oval && SP.oval.f) F.add(ovalAt('F', SP.oval.f));
    // Scheinwerfer
    const H = SP.head, headObjs = [];
    for (const sd of [1, -1]) {
      const hp = MR(H.poly, sd);
      const cz = H.poly.reduce((a, p) => a + p[0], 0) / H.poly.length, cy = H.poly.reduce((a, p) => a + p[1], 0) / H.poly.length;
      const border = H.poly.map(p => { const dz = p[0] - cz, dy = p[1] - cy, l = Math.hypot(dz, dy * 3) || 1; return [p[0] + dz / l * 0.007, p[1] + dy * 3 / l * 0.007]; });
      F.add(flatDecal(MR(border, sd), 'F', 0.003, mats.dark, { maxLen: 0.025 }));
      F.add(solidDecal(shapeOf(hp), 0.01, 'F', -0.002, mats.headChrome, { maxLen: 0.025 }));
      for (const [z, y, r] of H.lenses) {
        const p0 = facePose('F', y, sd * z, 0.009);
        const cup = new T.Mesh(new T.CircleGeometry(r, H.hex ? 6 : 32), mats.headDark);
        cup.position.copy(p0.p); orientTo(cup, p0.n); F.add(cup); headObjs.push(cup);
        const p1 = facePose('F', y, sd * z, 0.011);
        const bowl = new T.Mesh(new T.CircleGeometry(r * 0.8, 32), mats.reflector);
        bowl.position.copy(p1.p); orientTo(bowl, p1.n); F.add(bowl);
        const lens = new T.Mesh(new T.SphereGeometry(r * 0.48, 18, 10), mats.lens);
        lens.position.copy(p1.p); lens.scale.set(1, 1, 0.45); orientTo(lens, p1.n); F.add(lens);
        if (H.rings) {
          const ring = new T.Mesh(new T.TorusGeometry(r * 0.88, H.hex ? 0.0065 : 0.0058, 8, H.hex ? 6 : 40), mats.angel);
          ring.position.copy(p1.p).addScaledVector(p1.n, 0.004); orientTo(ring, p1.n);
          if (H.hex) ring.rotateZ(Math.PI / 6);
          F.add(ring);
        }
      }
      // LED-Tagfahrlicht als leuchtende Linie
      for (const pl of H.drl || []) {
        const pts = pl.map(p => [p[0] * sd, p[1]]);
        for (let i = 0; i + 1 < pts.length; i++) {
          const A = pts[i], B = pts[i + 1];
          let dz = B[0] - A[0], dy = B[1] - A[1]; const l = Math.hypot(dz, dy); dz /= l; dy /= l;
          const w = 0.0055, nz = -dy * w, ny = dz * w;
          F.add(flatDecal([[A[0] + nz - dz * w, A[1] + ny - dy * w], [B[0] + nz + dz * w, B[1] + ny + dy * w], [B[0] - nz + dz * w, B[1] - ny + dy * w], [A[0] - nz - dz * w, A[1] - ny - dy * w]], 'F', 0.016, mats.angel, { maxLen: 0.02 }));
        }
      }
      F.add(flatDecal(hp, 'F', 0.03, mats.headGlass, { maxLen: 0.02 }));
      if (H.ind) F.add(flatDecal(MR(H.ind, sd), 'F', 0.013, mats.tailClear, { maxLen: 0.02 }));
      if (H.indA) F.add(flatDecal(MR(H.indA, sd), 'F', 0.015, mats.amber, { maxLen: 0.02 }));
    }
    // Lufteinlässe, Nebelscheinwerfer
    const IN = SP.intake;
    F.add(flatDecal(roundRect(IN.center[0], IN.center[1], IN.center[2], IN.center[3], [0.03, 0.03, 0.045, 0.045], 5), 'F', 0.003, mats.dark));
    for (const y of IN.bars) F.add(flatDecal([[IN.center[0] + 0.02, y], [IN.center[1] - 0.02, y], [IN.center[1] - 0.02, y + 0.012], [IN.center[0] + 0.02, y + 0.012]], 'F', 0.006, mats.trim));
    for (const sd of [1, -1]) {
      const pocket = roundRect(IN.pocket[0], IN.pocket[1], IN.pocket[2], IN.pocket[3], [0.03, 0.04, 0.03, 0.03], 5);
      F.add(flatDecal(MR(pocket, sd), 'F', 0.003, mats.dark));
      if (IN.fog) {
        const p1 = facePose('F', IN.fog[1], sd * IN.fog[0], 0.008);
        const fl = new T.Mesh(new T.CircleGeometry(IN.fog[2], 24), mats.reflector); fl.position.copy(p1.p); orientTo(fl, p1.n); F.add(fl);
        const fr2 = new T.Mesh(new T.RingGeometry(IN.fog[2] * 0.92, IN.fog[2] * 1.08, 24), mats.headDark); fr2.position.copy(p1.p).addScaledVector(p1.n, 0.001); orientTo(fr2, p1.n); F.add(fr2);
        const fb = new T.Mesh(new T.CircleGeometry(IN.fog[2] * 0.4, 16), mats.fog); fb.position.copy(p1.p).addScaledVector(p1.n, 0.002); orientTo(fb, p1.n); F.add(fb);
      }
      if (IN.pocketBar) { const y = IN.pocketBar; F.add(flatDecal(MR([[IN.pocket[0] + 0.015, y], [IN.pocket[1] - 0.02, y + 0.02], [IN.pocket[1] - 0.02, y + 0.034], [IN.pocket[0] + 0.015, y + 0.014]], sd), 'F', 0.006, mats.trim)); }
    }
    // Stoßleiste vorn (E46: dunkle Schutzleiste quer über die Stoßstange, Kennzeichen sitzt darauf)
    if (SP.strip) {
      const st = SP.strip.f, stripMat = real(0x111214, 0.75, 0, { envMapIntensity: 0.4 });
      if (SP.stripPaint) {
        // lackierte Stoßleiste: nur die Schattenfugen oben und unten
        for (const y of [st[1], st[2]]) F.add(flatDecal([[-st[0], y - 0.0025], [st[0], y - 0.0025], [st[0], y + 0.0025], [-st[0], y + 0.0025]], 'F', 0.004, mats.dark, { maxLen: 0.02 }));
      } else
      F.add(flatDecal([[-st[0], st[1]], [st[0], st[1]], [st[0], st[2]], [-st[0], st[2]]], 'F', 0.006, stripMat, { maxLen: 0.02 }));
    }
    // Kennzeichen vorn
    const plateTex = plateTexture(cfg.plate || 'M·E 46');
    plateTex.wrapS = T.RepeatWrapping; plateTex.repeat.x = -1; plateTex.offset.x = 1;
    const plateMat = new T.MeshBasicMaterial({ map: plateTex, side: T.DoubleSide });
    F.add(flatDecal([[-0.26, SP.plateF[0]], [0.26, SP.plateF[0]], [0.26, SP.plateF[1]], [-0.26, SP.plateF[1]]], 'F', 0.012, plateMat, { uv: true }));
    // Abschlepp-Schlaufe (JDM-Style)
    const tow = new T.Mesh(new T.BoxGeometry(0.012, 0.09, 0.035), real(0xe21c2c, 0.5, 0));
    const tp0 = facePose('F', SP.tow[0], SP.tow[1], 0.012); tow.position.copy(tp0.p); tow.rotation.z = -0.25; F.add(tow);
    // Frontlippe / Splitter
    const lipGroup = new T.Group();
    { const sp = new T.Mesh(buildSplitter(), mats.trim); lipGroup.add(sp, outline(sp, 0.006)); bodyG.add(lipGroup); }
    // Roundel vorn
    if (!ROUNDEL_TEX) ROUNDEL_TEX = roundelTexture();
    if (SP.roundelY != null) {
      const pose = facePose('F', SP.roundelY, 0, SP.domeH ? 0.008 : 0.004, 0.03);
      const rd = new T.Mesh(new T.CircleGeometry(0.038, 32), new T.MeshBasicMaterial({ map: ROUNDEL_TEX }));
      rd.position.copy(pose.p); orientTo(rd, pose.n); F.add(rd);
    }

    // --- Seite ---
    for (const sd of [1, -1]) {
      const mg = new T.Group();
      const ms = new T.Shape();
      ms.moveTo(-0.05, -0.045); ms.lineTo(-0.05, 0.05);
      ms.quadraticCurveTo(0.03, 0.068, 0.062, 0.018);
      ms.quadraticCurveTo(0.072, -0.035, 0.0, -0.055); ms.closePath();
      const mgeo = new T.ExtrudeGeometry(ms, { depth: 0.17, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.014, bevelSegments: 3, curveSegments: 10 });
      mgeo.translate(0, 0, 0.035);
      const housing = new T.Mesh(mgeo, paint);
      const mglass = new T.Mesh(new T.PlaneGeometry(0.16, 0.085), mats.glass);
      mglass.rotation.y = -Math.PI / 2; mglass.position.set(-0.066, 0.004, 0.12);
      const foot = new T.Mesh(new T.BoxGeometry(0.1, 0.05, 0.07), mats.trim);
      foot.position.set(0.0, -0.025, 0.015);
      mg.add(housing, outline(housing, 0.005), mglass, foot);
      // F-/G-Modelle: Blinker im Spiegel
      if (!SP.sideInd) { const bl = new T.Mesh(new T.BoxGeometry(0.03, 0.012, 0.12), mats.amber); bl.position.set(0.02, -0.04, 0.12); mg.add(bl); }
      const mz = sideZ(SP.mirror[0], SP.mirror[2]);
      mg.position.set(SP.mirror[0], SP.mirror[1], sd * (mz - 0.01));
      mg.scale.z = sd;
      bodyG.add(mg);
      for (const hx of SP.handles) {
        // Griffmulde (dunkel) und darüber der Bügelgriff in Wagenfarbe
        bodyG.add(flatDecal(roundRect(hx - 0.092, hx + 0.092, SP.handleY - 0.03, SP.handleY + 0.02, [0.018, 0.018, 0.012, 0.012], 4), 'S', 0.003, mats.dark, { side: sd, maxLen: 0.03 }));
        const hp = roundRect(hx - 0.086, hx + 0.086, SP.handleY - 0.006, SP.handleY + 0.018, [0.01, 0.01, 0.01, 0.01], 4);
        bodyG.add(solidDecal(shapeOf(hp), 0.016, 'S', 0.002, paint, { side: sd, maxLen: 0.03 }));
      }
      if (SP.sideInd) {
        const q = SP.sideInd;
        bodyG.add(solidDecal(shapeOf(roundRect(q[0], q[1], q[2], q[3], [0.011, 0.011, 0.011, 0.011], 4)), 0.006, 'S', -0.001, mats.tailClear, { side: sd }));
        const mx = (q[0] + q[1]) / 2, my = (q[2] + q[3]) / 2;
        bodyG.add(flatDecal(roundRect(mx - 0.01, mx + 0.01, my - 0.0045, my + 0.0045, [0.004, 0.004, 0.004, 0.004], 2), 'S', 0.0065, mats.amber, { side: sd }));
      }
      // Rückleuchten-Seitenteil
      bodyG.add(flatDecal(SP.tail.side, 'S', 0.006, SP.tail.dark ? mats.tailDark : mats.tail, { side: sd, maxLen: 0.012 }));
      bodyG.add(flatDecal(SP.tail.sideIn, 'S', 0.009, mats.tailInner, { side: sd, maxLen: 0.012 }));
    }
    // Dachhöhe an Position (x, z)
    const roofY = (x, z) => {
      const s = section(x); let y = s.yr;
      for (let j = s.key[8]; j < s.pts.length - 1; j++) { const a = s.pts[j], b = s.pts[j + 1]; if (a[0] >= z && b[0] <= z) { y = a[1] + (b[1] - a[1]) * (a[0] - z) / (a[0] - b[0]); break; } }
      return y;
    };
    // Dachreling
    if (SP.rails) {
      const RL = SP.rails;
      for (const sd of [1, -1]) {
        const pts = [];
        for (let k = 0; k <= 30; k++) {
          const x = RL.x0 + (RL.x1 - RL.x0) * k / 30;
          const lift = (k === 0 || k === 30) ? 0.012 : RL.lift;
          pts.push(new T.Vector3(x, roofY(x, RL.z) + lift, sd * (RL.z + 0.005)));
        }
        const rail = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 60, 0.016, 8, false), mats.trim);
        bodyG.add(rail, outline(rail, 0.006));
        for (const k of [0, 30]) {
          const ft = new T.Mesh(new T.BoxGeometry(0.11, 0.06, 0.04), mats.trim);
          ft.position.copy(pts[k]).add(new T.Vector3(k ? 0.04 : -0.04, 0.012, 0)); bodyG.add(ft);
        }
        if (RL.lift > 0.04) { const ms = new T.Mesh(new T.BoxGeometry(0.06, 0.05, 0.03), mats.trim); ms.position.copy(pts[15]).add(new T.Vector3(0, -0.025, 0)); bodyG.add(ms); }
      }
    }
    // Antenne
    {
      const ax = SP.antenna.x, y = roofY(ax, 0);
      if (SP.antenna.type === 'fin') {
        const fs = new T.Shape(); fs.moveTo(0.1, 0); fs.quadraticCurveTo(-0.02, 0.005, -0.09, 0.06); fs.lineTo(-0.1, 0); fs.closePath();
        const fg = new T.ExtrudeGeometry(fs, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
        fg.translate(0, 0, -0.025);
        const fin = new T.Mesh(fg, paint); fin.position.set(ax, y - 0.004, 0); bodyG.add(fin, outline(fin, 0.004));
      } else {
        const ant = new T.Mesh(new T.CylinderGeometry(0.004, 0.006, 0.3, 6), mats.trim);
        ant.scale.y = 0.6; ant.position.set(ax, y + 0.09, 0); ant.rotation.z = 0.9; bodyG.add(ant);
      }
    }
    // Dachspoiler über der Heckscheibe
    const roofSpoiler = new T.Group();
    {
      const sx = SP.roofSpoiler, s = section(sx - 0.03);
      const hw = s.pts[s.key[9]][0] + (SP.spoilerFlush ? -0.01 : 0.03);
      const len = SP.spoilerLen || (SP.hatch ? 0.22 : (SP.spoilerFlush ? 0.11 : 0.16));
      const sp = new T.Shape();
      if (SP.spoilerFlush) { sp.moveTo(0, 0); sp.lineTo(-len, -0.022); sp.lineTo(-len + 0.012, -0.036); sp.lineTo(0, -0.03); }
      else { sp.moveTo(0, 0); sp.lineTo(-len, -0.035); sp.lineTo(-len + 0.01, -0.055); sp.lineTo(0, -0.03); }
      sp.closePath();
      const g = new T.ExtrudeGeometry(sp, { depth: hw * 2, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.01, bevelSegments: 2 });
      g.translate(0, 0, -hw);
      const m = new T.Mesh(g, paint);
      m.position.set(sx, s.yr + 0.035, 0);
      roofSpoiler.add(m, outline(m, 0.006));
      bodyG.add(roofSpoiler);
      const third = new T.Mesh(new T.BoxGeometry(0.01, 0.014, 0.36), mats.tail);
      third.position.set(sx - len + 0.015, s.yr - 0.012, 0); bodyG.add(third);
    }
    // GT-Flügel (Tuning)
    const gtWing = new T.Group(); gtWing.visible = false; bodyG.add(gtWing);
    {
      const wx = SP.roofSpoiler + 0.01, s = section(wx + 0.09);
      const af = new T.Shape();
      af.moveTo(0.14, 0); af.quadraticCurveTo(0.05, 0.045, -0.14, 0.012); af.lineTo(-0.14, -0.004); af.quadraticCurveTo(0.02, 0.008, 0.14, 0);
      const span = Math.min(1.6, s.hb * 1.75);
      const wg = new T.ExtrudeGeometry(af, { depth: span, bevelEnabled: false, curveSegments: 10 });
      wg.translate(0, 0, -span / 2);
      const wing = new T.Mesh(wg, mats.carbon); wing.rotation.z = 0.12; wing.position.set(wx, s.yr + 0.24, 0);
      gtWing.add(wing, outline(wing, 0.006));
      for (const sd of [1, -1]) {
        const ep = new T.Mesh(new T.BoxGeometry(0.34, 0.14, 0.012), mats.carbon);
        ep.position.set(wx, s.yr + 0.24, sd * (span / 2 + 0.006)); gtWing.add(ep, outline(ep, 0.005));
        const up = new T.Mesh(new T.BoxGeometry(0.11, 0.24, 0.018), mats.carbon);
        up.position.set(wx + 0.02, s.yr + 0.12, sd * 0.42); up.rotation.z = -0.2; gtWing.add(up, outline(up, 0.005));
      }
    }
    // --- weitere Spoiler ---
    const spoilerMat = paint;
    const sx0 = SP.roofSpoiler, sS = section(sx0 - 0.03), sHW = sS.pts[sS.key[9]][0] + 0.03;
    // Dachspoiler XL (länger, mit seitlichen Finnen)
    const bigRoof = new T.Group(); bigRoof.visible = false; bodyG.add(bigRoof);
    {
      const len = 0.32, sp = new T.Shape();
      sp.moveTo(0.02, 0.005); sp.lineTo(-len, -0.02); sp.lineTo(-len + 0.015, -0.06); sp.lineTo(0.02, -0.03); sp.closePath();
      const g = new T.ExtrudeGeometry(sp, { depth: sHW * 2, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.01, bevelSegments: 2 });
      g.translate(0, 0, -sHW);
      const m = new T.Mesh(g, spoilerMat); m.position.set(sx0, sS.yr + 0.04, 0); bigRoof.add(m, outline(m, 0.006));
      for (const sd of [1, -1]) {
        const fs = new T.Shape(); fs.moveTo(0.02, 0); fs.lineTo(-len, 0.0); fs.lineTo(-len + 0.04, 0.09); fs.closePath();
        const fg = new T.ExtrudeGeometry(fs, { depth: 0.012, bevelEnabled: false }); fg.translate(0, 0, -0.006);
        const f = new T.Mesh(fg, spoilerMat); f.position.set(sx0, sS.yr + 0.02, sd * (sHW - 0.01)); bigRoof.add(f, outline(f, 0.004));
      }
    }
    // Flügelprofil
    function wingProfile(chord, camber) {
      const af = new T.Shape(), c2 = chord / 2;
      af.moveTo(c2, 0); af.quadraticCurveTo(c2 * 0.35, camber, -c2, camber * 0.27); af.lineTo(-c2, -camber * 0.09); af.quadraticCurveTo(c2 * 0.15, camber * 0.18, c2, 0);
      return af;
    }
    // Swan-Neck-Flügel (von oben aufgehängt)
    const swan = new T.Group(); swan.visible = false; bodyG.add(swan);
    {
      const wx = sx0 - 0.02, s2 = section(wx + 0.09), span = Math.min(1.62, s2.hb * 1.8), wy = s2.yr + 0.3;
      const wg = new T.ExtrudeGeometry(wingProfile(0.3, 0.05), { depth: span, bevelEnabled: false, curveSegments: 10 }); wg.translate(0, 0, -span / 2);
      const wing = new T.Mesh(wg, mats.carbon); wing.rotation.z = 0.14; wing.position.set(wx, wy, 0); swan.add(wing, outline(wing, 0.006));
      for (const sd of [1, -1]) {
        const ep = new T.Mesh(new T.BoxGeometry(0.36, 0.16, 0.012), mats.carbon); ep.position.set(wx, wy, sd * (span / 2 + 0.006)); swan.add(ep, outline(ep, 0.005));
        const cv = new T.CatmullRomCurve3([new T.Vector3(wx + 0.12, s2.yr + 0.005, sd * 0.38), new T.Vector3(wx + 0.16, s2.yr + 0.16, sd * 0.38), new T.Vector3(wx + 0.1, wy + 0.1, sd * 0.38), new T.Vector3(wx - 0.02, wy + 0.04, sd * 0.38)]);
        const neck = new T.Mesh(new T.TubeGeometry(cv, 20, 0.014, 6, false), mats.carbon); neck.scale.z = 1; swan.add(neck, outline(neck, 0.004));
      }
    }
    // Time-Attack-Flügel (riesig, zwei Elemente)
    const ta = new T.Group(); ta.visible = false; bodyG.add(ta);
    {
      const wx = sx0 - 0.08, s2 = section(sx0 + 0.05), span = Math.min(1.78, s2.hb * 2.0), wy = s2.yr + 0.36;
      const w1 = new T.ExtrudeGeometry(wingProfile(0.42, 0.07), { depth: span, bevelEnabled: false, curveSegments: 10 }); w1.translate(0, 0, -span / 2);
      const m1 = new T.Mesh(w1, mats.carbon); m1.rotation.z = 0.1; m1.position.set(wx, wy, 0); ta.add(m1, outline(m1, 0.006));
      const w2 = new T.ExtrudeGeometry(wingProfile(0.16, 0.03), { depth: span, bevelEnabled: false, curveSegments: 8 }); w2.translate(0, 0, -span / 2);
      const m2 = new T.Mesh(w2, mats.carbon); m2.rotation.z = 0.55; m2.position.set(wx - 0.25, wy + 0.06, 0); ta.add(m2, outline(m2, 0.005));
      for (const sd of [1, -1]) {
        const ep = new T.Mesh(new T.BoxGeometry(0.62, 0.3, 0.014), mats.carbon); ep.position.set(wx - 0.08, wy + 0.02, sd * (span / 2 + 0.007)); ta.add(ep, outline(ep, 0.005));
        const up = new T.Mesh(new T.BoxGeometry(0.16, 0.38, 0.02), mats.carbon); up.position.set(wx + 0.06, s2.yr + 0.18, sd * 0.36); up.rotation.z = -0.25; ta.add(up, outline(up, 0.005));
      }
    }
    // Entenbürzel / Heckklappen-Lippe
    const duck = new T.Group(); duck.visible = false; bodyG.add(duck);
    {
      const TGd = SP.tailgate, yy = TGd.y1 - 0.03, xx = rearX(yy, 0);
      const ds = new T.Shape(); ds.moveTo(0.03, 0); ds.lineTo(-0.075, 0.035); ds.lineTo(-0.07, 0.05); ds.lineTo(0.03, 0.022); ds.closePath();
      const w = TGd.half * 1.9;
      const g = new T.ExtrudeGeometry(ds, { depth: w, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }); g.translate(0, 0, -w / 2);
      const m = new T.Mesh(g, spoilerMat); m.position.set(xx, yy, 0); duck.add(m, outline(m, 0.005));
    }

    // --- Innenraum + Fahrer (durch die getönten Scheiben sichtbar) ---
    let cig = null, cigTip = null, mouth = null, smokeArm = null, armPose = null, armL = null, cigTipObj = null;
    {
      const IN = new T.Group(); bodyG.add(IN);
      const dark = real(0x2a2b30, 0.7, 0), seatM = real(0x1c1d21, 0.8, 0), skin = real(0xe8b48a, 0.7, 0), shirt = real(0x2b4c8c, 0.9, 0), hair = real(0x2a1d14, 0.8, 0);
      const headX = SP.win.ws[0] - 0.36, belt = yDeck(headX);
      const hw = halfW(headX) - 0.12;
      const dashX = (SP.win.ws[1] + SP.win.ws[0]) / 2 + 0.05;
      const dash = new T.Mesh(new T.BoxGeometry(0.4, 0.14, hw * 2), dark); dash.position.set(dashX, yDeck(dashX) - 0.02, 0); IN.add(dash);
      for (const sd of [1, -1]) {
        const back = new T.Mesh(new T.BoxGeometry(0.13, 0.55, 0.46), seatM); back.position.set(headX - 0.1, belt - 0.12, sd * 0.37); back.rotation.z = 0.18; IN.add(back);
        const hr = new T.Mesh(new T.BoxGeometry(0.09, 0.17, 0.26), seatM); hr.position.set(headX - 0.17, belt + 0.21, sd * 0.37); hr.rotation.z = 0.18; IN.add(hr);
        if (SP.id !== 'f21' || true) {
          const rhr = new T.Mesh(new T.BoxGeometry(0.08, 0.14, 0.24), seatM); rhr.position.set(headX - 0.95, yDeck(headX - 0.95) + 0.12, sd * 0.38); IN.add(rhr);
        }
      }
      const bench = new T.Mesh(new T.BoxGeometry(0.14, 0.4, hw * 1.8), seatM); bench.position.set(headX - 0.9, yDeck(headX - 0.9) - 0.12, 0); bench.rotation.z = 0.15; IN.add(bench);
      // Lenkrad (Linkslenker)
      const sw = new T.Mesh(new T.TorusGeometry(0.17, 0.018, 8, 24), dark);
      sw.position.set(dashX - 0.26, belt + 0.02, -0.37); sw.rotation.y = Math.PI / 2; sw.rotation.x = 0; sw.rotateX(0); sw.rotation.z = 0; sw.lookAt(sw.position.x - 1, sw.position.y - 0.55, -0.37); IN.add(sw);
      // Fahrer
      const head = new T.Mesh(new T.SphereGeometry(0.1, 14, 10), skin); head.position.set(headX, belt + 0.16, -0.37); IN.add(head);
      // Raucher-Arm (links, Fensterseite): Oberarm, Unterarm, Hand mit Zigarette – Pose zwischen „aus dem Fenster“ und „zum Mund“
      smokeArm = new T.Group(); smokeArm.visible = false; IN.add(smokeArm);
      const limb = (r) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, 1, 8), shirt); smokeArm.add(m); return m; };
      const upper = limb(0.036), fore = limb(0.032);
      const handG = new T.Group(); smokeArm.add(handG);
      handG.add(new T.Mesh(new T.SphereGeometry(0.042, 10, 8), skin));
      const S0 = new T.Vector3(headX + 0.03, belt - 0.02, -0.54);
      const P_OUT = { e: new T.Vector3(headX + 0.12, belt + 0.005, -0.8), h: new T.Vector3(headX + 0.37, belt + 0.035, -1.0) };   // Ellbogen auf der Fensterkante
      const P_MOUTH = { e: new T.Vector3(headX + 0.17, belt - 0.07, -0.63), h: new T.Vector3(headX + 0.085, belt + 0.11, -0.43) };
      const setLimb = (m, a, b) => { const d = b.clone().sub(a), L = d.length(); m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); };
      armPose = (k) => {   // k: 0 = Hand draußen, 1 = Hand am Mund
        const e = P_OUT.e.clone().lerp(P_MOUTH.e, k), h = P_OUT.h.clone().lerp(P_MOUTH.h, k);
        setLimb(upper, S0, e); setLimb(fore, e, h); handG.position.copy(h);
        handG.rotation.set(0, 0.4 * (1 - k), 0.25 * (1 - k));   // draußen: Tschick zeigt nach vorn-oben
      };
      armPose(0);
      // Zigarette (Marlboro): Filter, Papier, Glut – zwischen den Fingern
      cig = new T.Group(); cig.position.set(0.0, 0.02, 0.0); cig.scale.setScalar(1.6); cig.visible = false; handG.add(cig);   // etwas größer, damit man sie von der Kamera aus sieht
      const cf = new T.Mesh(new T.CylinderGeometry(0.0048, 0.0048, 0.024, 8).rotateZ(Math.PI / 2), real(0xc98a3c, 0.7, 0)); cf.position.x = 0.012; cig.add(cf);
      const cp = new T.Mesh(new T.CylinderGeometry(0.0046, 0.0046, 0.06, 8).rotateZ(Math.PI / 2), real(0xf4f2ec, 0.8, 0)); cp.position.x = 0.054; cig.add(cp);
      cigTip = new T.MeshBasicMaterial({ color: 0xff5a14 });
      const ct = new T.Mesh(new T.CylinderGeometry(0.0047, 0.0047, 0.007, 8).rotateZ(Math.PI / 2), cigTip); ct.position.x = 0.087; cig.add(ct); cigTipObj = ct;
      mouth = new T.Vector3(headX + 0.09, belt + 0.135, -0.39);
      // Fahrerscheibe = Seitenscheibe, die vor dem Kopf liegt
      const wx = headX + 0.3, wp = SP.win.glass.find(gp => { const xs = gp.map(q => q[0]); return wx >= Math.min(...xs) && wx <= Math.max(...xs); });
      if (wp) {
        const xs = wp.map(q => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), xm = (x0 + x1) / 2;
        bodyMat.userData.u.uWin.value.set(x0 - 0.01, x1 + 0.01, yDeck(xm) + 0.012, yRoof(xm) + 0.05);
      }
      const cap = new T.Mesh(new T.SphereGeometry(0.104, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); cap.position.copy(head.position); cap.rotation.z = 0.35; IN.add(cap);
      const torso = new T.Mesh(new T.BoxGeometry(0.2, 0.42, 0.38), shirt); torso.position.set(headX + 0.01, belt - 0.12, -0.37); torso.rotation.z = 0.15; IN.add(torso);
      for (const dz of [-0.17, 0.17]) {
        const arm = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.42, 6), shirt);
        const p0 = new T.Vector3(headX + 0.03, belt - 0.02, -0.37 + dz), p1 = new T.Vector3(sw.position.x + 0.02, sw.position.y + 0.02, -0.37 + dz * 0.8);
        arm.position.copy(p0).add(p1).multiplyScalar(0.5);
        arm.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()); IN.add(arm);
        if (dz < 0) armL = arm;
      }
    }
    // Tankdeckel (rechts hinten)
    {
      const fx = AXR - 0.1, fy = yShoulder(fx) - 0.09;
      const o = roundRect(fx - 0.085, fx + 0.085, fy - 0.07, fy + 0.07, [0.02, 0.02, 0.02, 0.02], 4);
      const ii = roundRect(fx - 0.08, fx + 0.08, fy - 0.065, fy + 0.065, [0.017, 0.017, 0.017, 0.017], 4);
      const sh = shapeOf(o); sh.holes.push(shapeOf(ii.slice().reverse()));
      bodyG.add(solidDecal(sh, 0.002, 'S', -0.0005, mats.dark, { side: 1, maxLen: 0.03 }));
    }
    // Schiebedach (optional)
    const sunroof = new T.Group(); sunroof.visible = false; bodyG.add(sunroof);
    {
      const x0 = SP.win.ws[0] - 0.62, x1 = SP.win.ws[0] - 0.08, zW = 0.36, nx = 10, nz = 6;
      const pos = [], idx = [];
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { const x = x0 + (x1 - x0) * i / nx, z = -zW + 2 * zW * j / nz; pos.push(x, roofY(x, Math.abs(z)) + 0.004, z); }
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + nz + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const sr = new T.Mesh(g, real(0x0e141b, 0.04, 0, { envMapIntensity: 1.4 })); sunroof.add(sr);
    }
    // Scheibenwischer
    for (const sd of [1, -1]) {
      const w = new T.Mesh(new T.BoxGeometry(0.018, 0.012, 0.55), mats.trim);
      w.position.set(SP.wiper[0], SP.wiper[1], sd * 0.2 - 0.05); w.rotation.y = 0.08; w.rotation.z = -0.5; bodyG.add(w);
    }
    if (SP.rearWiper) {
      const w = new T.Mesh(new T.BoxGeometry(0.012, 0.012, 0.42), mats.trim);
      w.position.set(SP.rearWiper[0], SP.rearWiper[1], 0.1); w.rotation.x = 0.55; w.rotation.z = SP.hatch ? 0.75 : 1.0; bodyG.add(w);
    }

    // --- Heck ---
    const rearPlateMat = new T.MeshBasicMaterial({ map: plateTexture(cfg.plate || 'M·E 46'), side: T.DoubleSide });
    const R = new T.Group(); bodyG.add(R);
    if (SP.strip && SP.strip.r) {
      const st = SP.strip.r;
      if (SP.stripPaint) {
        // lackierte Stoßleiste: nur die Schattenfugen oben und unten
        for (const y of [st[1], st[2]]) R.add(flatDecal([[-st[0], y - 0.0025], [st[0], y - 0.0025], [st[0], y + 0.0025], [-st[0], y + 0.0025]], 'R', 0.004, mats.dark, { maxLen: 0.02 }));
      } else
      R.add(flatDecal([[-st[0], st[1]], [st[0], st[1]], [st[0], st[2]], [-st[0], st[2]]], 'R', 0.006, real(0x111214, 0.75, 0, { envMapIntensity: 0.4 }), { maxLen: 0.02 }));
    }
    const TL = SP.tail, TG = SP.tailgate;
    for (const sd of [1, -1]) {
      R.add(flatDecal(MR(TL.poly, sd), 'R', 0.004, TL.dark ? mats.tailDark : mats.tail, { maxLen: 0.02 }));
      for (const ip of TL.inner) R.add(flatDecal(MR(ip, sd), 'R', 0.006, mats.tailInner, { maxLen: 0.02 }));
      if (TL.gate) R.add(flatDecal(MR(TL.gate, sd), 'R', 0.004, TL.dark ? mats.tailDark : mats.tail, { maxLen: 0.02 }));
      if (TL.ind) R.add(flatDecal(MR(TL.ind, sd), 'R', 0.007, mats.tailClear, { maxLen: 0.02 }));
      R.add(flatDecal(MR(TL.rev, sd), 'R', 0.007, mats.tailClear, { maxLen: 0.02 }));
      R.add(flatDecal(MR([[TG.half - 0.003, TG.y0], [TG.half + 0.003, TG.y0], [TG.half + 0.003, TG.y1], [TG.half - 0.003, TG.y1]], sd), 'R', 0.002, mats.dark, { maxLen: 0.02 }));
    }
    R.add(flatDecal([[-TG.half, TG.y0 - 0.003], [TG.half, TG.y0 - 0.003], [TG.half, TG.y0 + 0.003], [-TG.half, TG.y0 + 0.003]], 'R', 0.002, mats.dark));
    if (SP.chromeBar) R.add(flatDecal([[-TG.half + 0.02, SP.chromeBar[0]], [TG.half - 0.02, SP.chromeBar[0]], [TG.half - 0.02, SP.chromeBar[1]], [-TG.half + 0.02, SP.chromeBar[1]]], 'R', 0.004, mats.chrome));
    const pr = SP.plateR;
    R.add(flatDecal(roundRect(-0.29, 0.29, pr[0] - 0.015, pr[1] + 0.015, [0.02, 0.02, 0.02, 0.02], 4), 'R', 0.002, mats.trim));
    R.add(flatDecal([[-0.26, pr[0]], [0.26, pr[0]], [0.26, pr[1]], [-0.26, pr[1]]], 'R', 0.006, rearPlateMat, { uv: true }));
    {
      if (SP.roundelR != null) {
        const pose = facePose('R', SP.roundelR, 0, 0.004);
        const rd = new T.Mesh(new T.CircleGeometry(0.036, 32), new T.MeshBasicMaterial({ map: ROUNDEL_TEX }));
        rd.position.copy(pose.p); orientTo(rd, pose.n); R.add(rd);
      }
      if (SP.oval && SP.oval.r) R.add(ovalAt('R', SP.oval.r));
      for (const bd of SP.badges) {
        const txt = (cfg.badge && bd === SP.badges[0]) ? cfg.badge : bd.t;   // Typenschild passend zum Motor (z. B. 330d)
        const bt = new T.MeshBasicMaterial({ map: badgeTexture(txt, 256, 64, bd.font), transparent: true });
        const bm = new T.Mesh(new T.PlaneGeometry(bd.w, 0.03), bt);
        const p1 = facePose('R', bd.y, bd.z, 0.004); bm.position.copy(p1.p); orientTo(bm, p1.n); R.add(bm);
      }
    }
    R.add(flatDecal(SP.diffuser, 'R', 0.003, mats.trim));
    const rf = SP.reflectors;
    for (const sd of [1, -1]) R.add(flatDecal(MR([[rf[0], rf[2]], [rf[1], rf[2]], [rf[1], rf[3]], [rf[0], rf[3]]], sd), 'R', 0.004, mats.tail));
    // Auspuff
    const exhaust = [];
    if (SP.exhaust.type === 'trap') {
      for (const [z, y, w, h] of SP.exhaust.tips) {
        const outerT = [[z - w / 2, y - h / 2], [z + w / 2, y - h / 2], [z + w / 2 - 0.02, y + h / 2], [z - w / 2 + 0.02, y + h / 2]];
        const innerT = [[z - w / 2 + 0.012, y - h / 2 + 0.012], [z + w / 2 - 0.012, y - h / 2 + 0.012], [z + w / 2 - 0.028, y + h / 2 - 0.012], [z - w / 2 + 0.028, y + h / 2 - 0.012]];
        const o = z < 0 ? outerT.slice().reverse() : outerT, ii = z < 0 ? innerT.slice().reverse() : innerT;
        R.add(flatDecal(o, 'R', 0.006, mats.chrome), flatDecal(ii, 'R', 0.009, mats.dark));
        exhaust.push(new T.Vector3(rearX(y, z) - 0.04, y, z));
      }
    } else {
      for (const [z, y, r] of SP.exhaust.tips) {
        const ex = new T.Mesh(new T.CylinderGeometry(r, r, 0.12, 18, 1, true), mats.chrome);
        ex.rotation.z = Math.PI / 2;
        const x = rearX(y + 0.02, z);
        ex.position.set(x + 0.005, y, z);
        const inner = new T.Mesh(new T.CircleGeometry(r * 0.84, 18), mats.dark);
        inner.position.set(x - 0.05, y, z); inner.rotation.y = -Math.PI / 2;
        R.add(ex, inner, outline(ex, 0.005));
        exhaust.push(new T.Vector3(x - 0.08, y, z));
      }
    }

    // --- Räder ---
    const wheels = [];
    const wScale = WHEEL_R / 0.316;
    const AF = AXF, AR = AXR, WR = WHEEL_R, TH = SP.trackHalf;
    const wheelOpt = { rimR: (RIM_SIZES[cfg.rimSize == null ? 1 : cfg.rimSize] || RIM_SIZES[1]).r, letters: !!cfg.letters, brand: SP.brand };
    let curRimStyle = cfg.rimStyle, lipHex = 0xd9dde2;
    function makeWheels(style) {
      curRimStyle = style;
      for (const w of wheels) root.remove(w.pivot);
      wheels.length = 0;
      for (const [ax, front] of [[AF, true], [AR, false]]) {
        for (const sd of [1, -1]) {
          const pivot = new T.Group(); pivot.rotation.order = 'YXZ';
          const flip = new T.Group(); if (sd < 0) flip.rotation.y = Math.PI;
          flip.scale.setScalar(wScale);
          const spin = buildWheel(style, mats, sd, wheelOpt);
          flip.add(spin); pivot.add(flip);
          const cal = new T.Mesh(new T.BoxGeometry(0.11, 0.06, 0.045), mats.caliper);
          cal.position.set(front ? -0.12 : 0.12, 0.08, 0.01); cal.rotation.z = front ? 0.6 : -0.6;
          flip.add(cal);
          spin.traverse(o => { if (o.isMesh && o.material !== OUTLINE && o.material.type !== 'ShaderMaterial') o.castShadow = true; });
          root.add(pivot);
          wheels.push({ pivot, spin, side: sd, front, ax });
        }
      }
      applyStance();
    }
    const stance = { drop: cfg.drop, camber: cfg.camber, track: cfg.track };
    function applyStance() {
      for (const w of wheels) {
        w.pivot.position.set(w.ax, WR, w.side * (TH + stance.track));
        w.pivot.rotation.x = (w.side > 0 ? -1 : 1) * stance.camber * Math.PI / 180 * (w.front ? 0.8 : 1);
      }
      chassis.position.y = -stance.drop;
    }
    makeWheels(cfg.rimStyle);
    let curPlate = cfg.plate || 'M·E 46';

    // weicher Schatten direkt unter dem Auto
    {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const blob = new T.Mesh(new T.PlaneGeometry((XF - XR) * 1.12, TH * 2.75), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.set((XF + XR) / 2, 0.022, 0); blob.renderOrder = 1; root.add(blob);
    }
    // Unterbodenbeleuchtung
    const neonTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c);
    })();
    const neon = new T.Mesh(new T.PlaneGeometry((XF - XR) * 1.15, TH * 2.9), new T.MeshBasicMaterial({ map: neonTex, color: 0x00e5ff, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
    neon.rotation.x = -Math.PI / 2; neon.position.set((XF + XR) / 2, 0.025, 0); neon.visible = false; neon.renderOrder = 2;
    root.add(neon);

    const api = {
      root, chassis, wheels, exhaust, model: SP.id, spec: SP, diesel: !!(cfg.diesel || SP.diesel),
      lights: { tail: mats.tail, tailInner: mats.tailInner },
      setPaint(hex) { bodyMat.color.setHex(hex); paint.color.setHex(hex); },
      setRimStyle(i) { makeWheels(i); },
      setRimColor(hex) { mats.rim.color.setHex(hex); if (lipHex == null) mats.lip.color.setHex(hex); },
      // Felgengröße (Index), Reifenschrift, Farbe des Felgenbetts
      setWheelOpts(o) {
        let rebuild = false;
        if (o.size != null) { const r = (RIM_SIZES[o.size] || RIM_SIZES[1]).r; if (r !== wheelOpt.rimR) { wheelOpt.rimR = r; rebuild = true; } }
        if (o.letters != null && !!o.letters !== wheelOpt.letters) { wheelOpt.letters = !!o.letters; rebuild = true; }
        if (o.lip !== undefined) { lipHex = o.lip; mats.lip.color.setHex(lipHex == null ? mats.rim.color.getHex() : lipHex); }
        if (rebuild) makeWheels(curRimStyle);
      },
      setStance(o) { Object.assign(stance, o); applyStance(); },
      // Optik-Tuning
      setLook(o) {
        o = o || {};
        if (o.spoiler != null) {
          const sp = o.spoiler;
          roofSpoiler.visible = sp !== 2 && sp !== 3; bigRoof.visible = sp === 3;
          gtWing.visible = sp === 1; swan.visible = sp === 4; ta.visible = sp === 5; duck.visible = sp === 6;
        }
        if (o.finish != null) {
          const f = FINISHES[o.finish] || FINISHES[0];
          for (const m of [bodyMat, paint]) { m.roughness = f.rough; m.metalness = f.metal; m.clearcoat = f.coat; m.clearcoatRoughness = f.coatRough; m.needsUpdate = true; }
        }
        if (o.sunroof != null) sunroof.visible = !!o.sunroof;
        if (o.lip != null) lipGroup.visible = !!o.lip;
        if (o.tow != null) tow.visible = !!o.tow;
        if (o.tint != null) {
          const c = new T.Color(0x34475c).lerp(new T.Color(0x050608), Math.max(0, Math.min(1, o.tint / 100)));
          bodyMat.userData.u.uGlass.value.copy(c); mats.glass.color.copy(c);
          bodyMat.userData.u.uGlassA.value = 0.5 + Math.max(0, Math.min(1, o.tint / 100)) * 0.46;
        }
        if (o.angel != null) mats.angel.color.setHex(o.angel);
        if (o.neon != null) { neon.visible = o.neon !== 0; if (o.neon) neon.material.color.setHex(o.neon); }
        if (o.caliper != null) mats.caliper.color.setHex(o.caliper);
        if (o.plate != null && o.plate !== curPlate) {
          curPlate = o.plate;
          const t1 = plateTexture(o.plate); t1.wrapS = T.RepeatWrapping; t1.repeat.x = -1; t1.offset.x = 1;
          plateMat.map.dispose(); plateMat.map = t1; plateMat.needsUpdate = true;
          rearPlateMat.map.dispose(); rearPlateMat.map = plateTexture(o.plate); rearPlateMat.needsUpdate = true;
        }
      },
      // Fahrerfenster (0 = zu … 1 = unten) und Zigarette im Mund
      setWindow(v) { bodyMat.userData.u.uWinDown.value = Math.max(0, Math.min(1, v)); },
      setCig(on, glow) { if (cig) { cig.visible = !!on; cigTip.color.setHex(glow ? 0xffa040 : 0xc23a0c); } },
      // Arm aus dem Fenster (on) – k: 0 = Hand draußen, 1 = Hand am Mund (beim Zug)
      setSmokeArm(on, k) { if (!smokeArm) return; smokeArm.visible = !!on; if (armL) armL.visible = !on; if (on) armPose(Math.max(0, Math.min(1, k || 0))); },
      cigTipWorld(v) { return cigTipObj ? cigTipObj.getWorldPosition(v || new T.Vector3()) : null; },
      headlights: headObjs, glareSize: 0.9,
      mouth,
      setBrake(on) {
        mats.tail.color.setHex(on ? 0xff2633 : 0xa50e17);
        mats.tailInner.color.setHex(on ? 0xff6a6a : 0xd8202a);
        mats.tailDark.color.setHex(on ? 0xc4141e : 0x4a080c);
      },
      update(st) {
        for (const w of wheels) {
          w.spinAngle = (w.spinAngle || 0) + (w.front ? st.frontSpin : st.rearSpin);
          w.spin.rotation.z = w.side > 0 ? -w.spinAngle : w.spinAngle;
          w.pivot.rotation.y = w.front ? st.steer : 0;
        }
        chassis.rotation.order = 'XZY';
        chassis.rotation.x = st.roll || 0;
        chassis.rotation.z = st.pitch || 0;
      },
      dispose() {
        root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m !== OUTLINE) { if (m.map && m.map !== ROUNDEL_TEX && m.map !== OVAL_TEX && m.map !== OVAL_CAP_TEX) m.map.dispose(); m.dispose(); } } } });
      },
      dims: { XF, XR, AXF, AXR, WHEEL_R, halfW: Math.max(...SP.halfW.map(p => p[1])), trackHalf: TH }
    };
    return api;
  }

  // Splitter (Frontlippe) als flache Platte entlang der Frontkontur
  function buildSplitter() {
    const N = 40, pos = [], idx = [];
    const SPL = S.split, y0 = SPL.y, y1 = SPL.y + 0.018, W = SPL.w;
    const outer = [], inner = [];
    for (let k = 0; k <= N; k++) {
      const z = -W + 2 * W * k / N;
      const xf = frontX(SPL.ref, z * 0.985);
      const ex = 0.045 * (1 - Math.pow(Math.abs(z) / W, 4));
      outer.push([xf + ex, z]);
      inner.push([xf - 0.10, z * 0.97]);
    }
    const pushV = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
    const oT = [], oB = [], iT = [], iB = [];
    for (let k = 0; k <= N; k++) {
      oT.push(pushV(outer[k][0], y1, outer[k][1])); oB.push(pushV(outer[k][0], y0, outer[k][1]));
      iT.push(pushV(inner[k][0], y1, inner[k][1])); iB.push(pushV(inner[k][0], y0, inner[k][1]));
    }
    for (let k = 0; k < N; k++) {
      idx.push(iT[k], oT[k + 1], oT[k], iT[k], iT[k + 1], oT[k + 1]);
      idx.push(iB[k], oB[k], oB[k + 1], iB[k], oB[k + 1], iB[k + 1]);
      idx.push(oB[k], oT[k], oT[k + 1], oB[k], oT[k + 1], oB[k + 1]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  const SMOKE_COLORS = [
    { name: 'Weiß', rgb: [0.98, 0.98, 0.98] }, { name: 'Grau', rgb: [0.62, 0.64, 0.67] }, { name: 'Rot', rgb: [1.0, 0.25, 0.25] },
    { name: 'Blau', rgb: [0.3, 0.55, 1.0] }, { name: 'Gelb', rgb: [1.0, 0.86, 0.2] }, { name: 'Pink', rgb: [1.0, 0.42, 0.75] },
    { name: 'Grün', rgb: [0.35, 0.95, 0.45] }, { name: 'Lila', rgb: [0.68, 0.4, 1.0] }, { name: 'Orange', rgb: [1.0, 0.55, 0.15] },
    { name: 'Schwarz', rgb: [0.16, 0.16, 0.18] }
  ];
  const ANGEL_COLORS = [{ name: 'Weiß', hex: 0xf6fbff }, { name: 'Eisblau', hex: 0x9fd8ff }, { name: 'Gelb', hex: 0xffe27a }, { name: 'Rot', hex: 0xff5a5a }];
  const LOOK_DEF = { finish: 0, spoiler: 0, sunroof: false, lip: true, tow: true, tint: 70, angel: 0, plate: 'M·E 46', smoke: 0, flames: true, neon: 0, caliper: 0, camo: false };
  const NEON_COLORS = [{ name: 'Aus', hex: 0 }, { name: 'Cyan', hex: 0x00e5ff }, { name: 'Pink', hex: 0xff2bd6 }, { name: 'Grün', hex: 0x39ff6a }, { name: 'Lila', hex: 0x8a4dff }, { name: 'Rot', hex: 0xff2a2a }];
  const CALIPER_COLORS = [{ name: 'Rot', hex: 0xc6262a }, { name: 'Blau', hex: 0x1f5fd6 }, { name: 'Gelb', hex: 0xf2c21b }, { name: 'Schwarz', hex: 0x1b1c1f }, { name: 'Gold', hex: 0xc9a33a }, { name: 'Orange', hex: 0xf07a1a }];
  function lookFromCfg(cfg) {
    const o = Object.assign({}, LOOK_DEF, cfg || {});
    return { finish: o.finish | 0, spoiler: o.spoiler | 0, sunroof: !!o.sunroof, lip: !!o.lip, tow: !!o.tow, tint: +o.tint, angel: (ANGEL_COLORS[o.angel | 0] || ANGEL_COLORS[0]).hex, plate: String(o.plate || 'M·E 46').slice(0, 10), neon: (NEON_COLORS[o.neon | 0] || NEON_COLORS[0]).hex, caliper: (CALIPER_COLORS[o.caliper | 0] || CALIPER_COLORS[0]).hex, camo: !!o.camo };
  }
  const smokeRGB = (cfg) => (SMOKE_COLORS[(cfg && cfg.smoke) | 0] || SMOKE_COLORS[0]).rgb;

  useModel('e46');
  window.E46 = { mat: { real: (...a) => real(...a), carPaint: (...a) => carPaint(...a), envMap: () => envMap() }, create, setFlash, setNight, FINISHES, PAINTS, RIM_COLORS, RIMS, RIM_SIZES, LIP_COLORS, SMOKE_COLORS, ANGEL_COLORS, NEON_COLORS, CALIPER_COLORS, LOOK_DEF, lookFromCfg, smokeRGB, toon, addRim, outline, GRAD, section, dims: { XF, XR, AXF, AXR, WHEEL_R } };
})();
