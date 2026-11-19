/* =====================================================================
   Strecken / Maps
   - "Hakone Lane": kompakter Drift-Kurs, Werkstatt im Infield
   - "Großer Ring": lange Rennstrecke, Werkstatt + Tankstelle im Infield
   - "Bergpass": 8,9 km über einen Berg, Serpentinen rauf und runter, echtes Höhenprofil
   Befahrbarer Bereich = Vereinigung aus Strecke, Boxengasse, Hof, Halle
   (Signed-Distance-Felder), minus Hindernisse (Zapfsäulen, Gebäude).
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const ROAD = 8.0, RUNOFF = 12.6, WALL = 13.0, WALL_T = 0.5, WALL_H = 1.1;
  const PIT_HW = 6.0;

  // Bergpass: Rundkurs, im Osten in Serpentinen rauf, über den Grat nach Westen, im Westen in Serpentinen runter
  function mountainCtrl(o) {
    o = Object.assign({ peak: 230, seed: 29 }, o || {});
    let seed = o.seed; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pts = [];
    const push = (x, z, y) => pts.push([x, z, y]);
    // geschlängelt von A nach B; bulge = Ausbeulung zur Seite (Bogen über die ganze Länge)
    function esses(ax, az, bx, bz, ya, yb, amp, lam, bulge) {
      const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      const n = Math.max(2, Math.round(L / 15));
      let phase = rnd() * 6.28, a = amp * (0.7 + 0.6 * rnd()), l = lam * (0.8 + 0.4 * rnd()), aT = a, lT = l;
      for (let i = 1; i <= n; i++) {
        const s = i / n * L;
        phase += (L / n) / l * Math.PI * 2;
        if (rnd() < 0.06) { aT = amp * (0.55 + 0.9 * rnd()); lT = lam * (0.75 + 0.5 * rnd()); }
        a += (aT - a) * 0.12; l += (lT - l) * 0.12;          // weich überblenden, sonst entstehen Knicke
        const ss = (q) => { q = Math.max(0, Math.min(1, q)); return q * q * (3 - 2 * q); };
        const env = ss(s / 70) * ss((L - s) / 70);               // weich ein- und ausblenden (kein Knick am Übergang)
        const off = Math.sin(phase) * a * env + (bulge || 0) * (1 - Math.cos(2 * Math.PI * s / L)) / 2;
        push(ax + tx * s + nx * off, az + tz * s + nz * off, ya + (yb - ya) * (s / L));
      }
    }
    // Serpentinen: Schenkel abwechselnd in +x/-x, jede Kehre rückt um sp in zdir weiter
    function stack(xs, zs, dir, zdir, legs, xIn, xOut, y0, y1) {
      let x = xs, z = zs;
      const seg = [];
      for (let k = 0; k < legs; k++) {
        const far = dir > 0 ? xOut : xIn, near = dir > 0 ? xIn : xOut;
        const xe = (dir > 0 ? Math.max : Math.min)(x + dir * 120, (dir > 0 ? xOut : xIn) + (rnd() - 0.5) * 70);
        const slant = (rnd() - 0.5) * 22;
        seg.push({ type: 'leg', x0: x, z0: z, x1: xe, z1: z + slant });
        z += slant; x = xe;
        if (k < legs - 1) { const sp = 64 + rnd() * 18; seg.push({ type: 'pin', x, z, dir, sp, zdir }); z += zdir * sp; dir = -dir; }
        void far; void near;
      }
      // Länge für das Höhenprofil
      let tot = 0; for (const g of seg) tot += g.type === 'leg' ? Math.hypot(g.x1 - g.x0, g.z1 - g.z0) * 1.08 : Math.PI * g.sp / 2;
      let s = 0; const yA = (q) => y0 + (y1 - y0) * q / tot;
      for (const g of seg) {
        if (g.type === 'leg') { const L = Math.hypot(g.x1 - g.x0, g.z1 - g.z0) * 1.08; esses(g.x0, g.z0, g.x1, g.z1, yA(s), yA(s + L), 9, 170, 0); s += L; }
        else {
          const R = g.sp / 2, L = Math.PI * R, cx = g.x, cz = g.z + g.zdir * R;
          for (let i = 1; i <= 5; i++) { const t = i / 6, a = -Math.PI / 2 + t * Math.PI; push(cx + g.dir * Math.cos(a) * R * 1.15, cz + g.zdir * Math.sin(a) * R, yA(s + L * t)); }
          s += L;
        }
      }
      return { x, z, dir };
    }
    const P = o.peak;
    push(-100, 40, 0); push(0, 40, 0); push(80, 40, 0);                 // Start/Ziel (Werkstatt nördlich davon)
    esses(80, 40, 480, 34, 0, 4, 24, 190, 0);                          // Tal nach Osten
    const e = stack(480, 34, 1, -1, 8, 470, 780, 4, P - 25);           // Ostflanke rauf (nach Norden)
    esses(e.x, e.z, -480, e.z, P - 25, P - 25, 30, 230, -70);          // Grat nach Westen, nach Norden ausgebeult
    const w = stack(-480, e.z, -1, 1, 8, -790, -480, P - 25, 4);       // Westflanke runter (nach Süden)
    esses(w.x, w.z, -170, 40, 4, 0, 22, 180, 0);                       // Tal zurück zum Start
    return pts;
  }

  // Die Gerade: 5 km schnurgerade (Start im Westen, Fahrt nach Osten), Wendeschleife, parallele Rückfahrt, Wendeschleife
  function straightCtrl() {
    const X0 = -2500, X1 = 2530, ZA = 40, R = 110, ZB = ZA - 2 * R, pts = [];
    // Stützpunkte zu den Enden hin dichter, sonst schwingt der Spline aus der Wendeschleife in die Gerade nach
    const xs = [X0, X0 + 8, X0 + 20, X0 + 40, X0 + 70, X0 + 110];
    for (let x = X0 + 250; x < X1 - 110; x += 250) xs.push(x);
    xs.push(X1 - 110, X1 - 70, X1 - 40, X1 - 20, X1 - 8, X1);
    for (const x of xs) pts.push([x, ZA]);
    for (let i = 1; i < 12; i++) { const a = Math.PI / 2 - i / 12 * Math.PI; pts.push([X1 + Math.cos(a) * R, ZA - R + Math.sin(a) * R]); }   // Osten: Wendeschleife nach Süden
    for (const x of xs) pts.push([X0 + X1 - x, ZB]);                     // Rückfahrt von Osten nach Westen
    for (let i = 1; i < 12; i++) { const a = -Math.PI / 2 - i / 12 * Math.PI; pts.push([X0 + Math.cos(a) * R, ZA - R + Math.sin(a) * R]); }  // Westen: zurück auf die Startgerade
    return pts;
  }

  const MAPS = {
    hakone: {
      id: 'hakone', name: 'Hakone Lane', desc: 'Kompakter Drift-Kurs · 0,8 km · Werkstatt', fuel: false,
      ctrl: [[-100, 40], [0, 40], [80, 40], [130, 20], [152, -30], [132, -82], [84, -102], [44, -92], [22, -62],
        [0, -44], [-24, -46], [-44, -66], [-70, -92], [-108, -100], [-145, -72], [-160, -20], [-145, 24]],
      // Werkstatthalle (Innenraum), Hof davor, Tor dazwischen, Boxengasse zur Strecke
      hall: { x0: 63, x1: 107, z0: -48, z1: -34 },
      yard: { x0: 63, x1: 107, z0: -32, z1: -6 },
      pit: [[86, -8], [85, 8], [79, 22], [70, 34]],
      lift: { x0: 99.5, x1: 105, z0: -46.5, z1: -37 },
      gas: null, world: 1
    },
    big: {
      id: 'big', name: 'Großer Ring', desc: 'Rennstrecke · 2,0 km · 22 Kurven · Werkstatt & Tankstelle', fuel: true,
      ctrl: [[-300, 120], [-140, 120], [0, 120], [70, 116], [115, 135], [165, 140], [205, 118], [250, 80], [300, 85], [345, 55], [358, 0], [345, -45],
        [320, -95], [285, -115], [262, -155], [215, -188], [160, -172], [128, -130], [100, -85], [65, -55], [25, -58], [-5, -88], [-32, -122],
        [-78, -132], [-118, -172], [-172, -192], [-245, -180], [-300, -150], [-335, -110], [-330, -62], [-355, -22], [-380, 25], [-362, 78], [-330, 110]],
      hall: { x0: -250, x1: -206, z0: -44, z1: -30 },
      yard: { x0: -262, x1: -130, z0: -28, z1: 40 },
      pit: [[-200, 38], [-200, 64], [-193, 88], [-182, 111]],
      lift: { x0: -213.5, x1: -208, z0: -42.5, z1: -33 },
      gas: { cx: -158, cz: 8 }, world: 1.6,
      crossing: 210                             // Zebrastreifen auf der Startgeraden (Index im Pfad, hinter der Tribüne)
    },
    // Achter mit Brücke: die eine Diagonale führt über eine Rampe auf die Brücke, die andere unten durch
    bridge: {
      id: 'bridge', name: 'Brückenachter', desc: 'Achterkurs · 1,35 km · Brücke drüber & drunter · Werkstatt', fuel: false,
      ctrl: [[-225, 40], [-225, -30], [-200, -88], [-140, -108], [-80, -80], [0, 0], [80, 80], [130, 112], [180, 100], [198, 58], [182, 15],
        [204, -30], [186, -82], [140, -106], [80, -80], [0, 0], [-80, 80], [-140, 110], [-200, 98]],
      hall: { x0: -195, x1: -151, z0: -24, z1: -10 },
      yard: { x0: -195, x1: -151, z0: -8, z1: 18 },
      pit: [[-186, 16], [-193, 30], [-204, 42], [-216, 54]],
      lift: { x0: -158.5, x1: -153, z0: -22.5, z1: -13 },
      gas: null, world: 1.2, standSide: -1,
      bridge: { h: 7, flat: 20, ramp: 72, span: 16, deck: 1.0 }
    },
    // Bergpass: Start im Tal (Werkstatt wie bei Hakone), Ostflanke in 7 Kehren rauf, über den Grat, Westflanke in 7 Kehren runter
    mountain: {
      id: 'mountain', name: 'Bergpass', desc: 'Bergrundkurs · 8,9 km · 14 Kehren · 200 m rauf & runter · Werkstatt', fuel: false,
      ctrl: mountainCtrl(),
      hall: { x0: 63, x1: 107, z0: -48, z1: -34 },
      yard: { x0: 63, x1: 107, z0: -32, z1: -6 },
      pit: [[86, -8], [85, 8], [79, 22], [70, 34]],
      lift: { x0: 99.5, x1: 105, z0: -46.5, z1: -37 },
      gas: null, world: 2.2, mountain: true
    },
    // Die Gerade: Werkstatt wie bei Hakone, nur an den Anfang der 5-km-Geraden verschoben
    straight: {
      id: 'straight', name: 'Die Gerade', desc: 'Vollgas · 5 km schnurgerade · Wendeschleifen · Werkstatt', fuel: false,
      ctrl: straightCtrl(),
      hall: { x0: -2337, x1: -2293, z0: -48, z1: -34 },
      yard: { x0: -2337, x1: -2293, z0: -32, z1: -6 },
      pit: [[-2314, -8], [-2315, 8], [-2321, 22], [-2330, 34]],
      lift: { x0: -2300.5, x1: -2295, z0: -46.5, z1: -37 },
      gas: null, world: 2.0
    }
  };

  function catmull(p0, p1, p2, p3, t) {
    const a = 0.5;
    const tj = (ti, pi, pj) => ti + Math.max(1e-4, Math.pow(Math.hypot(pj[0] - pi[0], pj[1] - pi[1]), a));
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3), tt = t1 + (t2 - t1) * t;
    const L = (A, B, ta, tb) => [(tb - tt) / (tb - ta) * A[0] + (tt - ta) / (tb - ta) * B[0], (tb - tt) / (tb - ta) * A[1] + (tt - ta) / (tb - ta) * B[1]];
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  }
  // Spline -> gleichmäßige Abtastpunkte mit Tangente, Normale (rechts), Krümmung
  function buildPath(ctrl, closed, step) {
    const raw = [], n = ctrl.length;
    const P = (i) => closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) for (let k = 0; k < 80; k++) raw.push(catmull(P(i - 1), P(i), P(i + 1), P(i + 2), k / 80));
    if (!closed) raw.push(ctrl[n - 1].slice());
    const cum = [0]; let len = 0;
    const M = closed ? raw.length : raw.length - 1;
    for (let i = 1; i <= M; i++) { const a = raw[i - 1], b = raw[i % raw.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(len); }
    const N = Math.max(2, Math.round(len / step)), S = [];
    let j = 0;
    for (let i = 0; i < (closed ? N : N + 1); i++) {
      const d = Math.min(len, i * len / N);
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const f = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), a = raw[j], b = raw[(j + 1) % raw.length];
      S.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, s: d });
    }
    const K = S.length;
    for (let i = 0; i < K; i++) {
      const a = closed ? S[(i - 1 + K) % K] : S[Math.max(0, i - 1)], b = closed ? S[(i + 1) % K] : S[Math.min(K - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      S[i].tx = tx; S[i].tz = tz; S[i].rx = -tz; S[i].rz = tx;
    }
    for (let i = 0; i < K; i++) {
      const a = closed ? S[(i - 4 + K) % K] : S[Math.max(0, i - 4)], b = closed ? S[(i + 4) % K] : S[Math.min(K - 1, i + 4)];
      let dd = Math.atan2(-b.tz, b.tx) - Math.atan2(-a.tz, a.tx);
      while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
      S[i].k = dd / 8;
    }
    const ks = []; for (let i = 0; i < n; i++) ks.push(cum[Math.min(cum.length - 1, i * 80)]);   // Bogenlänge an jedem Stützpunkt
    return { S, len, closed, ks };
  }

  // ---------- Canvas-Texturen ----------
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
  function textTex(text, w, h, bg, fg, font) {
    return canvasTex(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2, w - 20);
    });
  }

  // ---------- Signed-Distance-Formen (befahrbar) ----------
  function corridorShape(path, hw) {
    const S = path.S, N = S.length, closed = path.closed;
    return {
      type: 'corridor', path, hw,
      nearest(x, z, hint) {
        let bi = 0, bd = 1e18;
        if (hint != null && hint >= 0 && hint < N) {
          for (let k = -30; k <= 30; k++) {
            let i = hint + k; if (closed) i = (i + N) % N; else if (i < 0 || i >= N) continue;
            const dx = x - S[i].x, dz = z - S[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; }
          }
          if (bd < 900) return bi;
        }
        for (let i = 0; i < N; i++) { const dx = x - S[i].x, dz = z - S[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
        return bi;
      },
      sd(x, z, hint) {
        const i = this.nearest(x, z, hint), p = S[i];
        const lat = (x - p.x) * p.rx + (z - p.z) * p.rz, lon = (x - p.x) * p.tx + (z - p.z) * p.tz;
        let d = Math.abs(lat) - hw, gx = p.rx * Math.sign(lat || 1), gz = p.rz * Math.sign(lat || 1);
        if (!closed) {
          if (i === 0 && lon < 0 && -lon > d) { d = -lon; gx = -p.tx; gz = -p.tz; }
          if (i === N - 1 && lon > 0 && lon > d) { d = lon; gx = p.tx; gz = p.tz; }
        }
        return { d, gx, gz, i, lat };
      }
    };
  }
  function rectShape(r) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
    return {
      type: 'rect', r, cx, cz, hx, hz,
      sd(x, z) {
        const px = x - cx, pz = z - cz, qx = Math.abs(px) - hx, qz = Math.abs(pz) - hz;
        if (qx > 0 || qz > 0) {
          const ox = Math.max(qx, 0), oz = Math.max(qz, 0), l = Math.hypot(ox, oz) || 1;
          return { d: l, gx: ox / l * Math.sign(px || 1), gz: oz / l * Math.sign(pz || 1) };
        }
        return qx > qz ? { d: qx, gx: Math.sign(px || 1), gz: 0 } : { d: qz, gx: 0, gz: Math.sign(pz || 1) };
      }
    };
  }

  function circleShape(cx, cz, r) {
    return {
      type: 'circle', cx, cz, r,
      sd(x, z) { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return { d: l - r, gx: dx / l, gz: dz / l }; }
    };
  }
  function build(scene, renderer, mapId) {
    const MAP = MAPS[mapId] || MAPS.hakone;
    const W = MAP.world;
    const path = buildPath(MAP.ctrl, true, 1.0);
    const S = path.S, N = S.length;
    for (const p of S) p.y = 0;
    // ---------- Brücke: Kreuzungspunkt suchen, obere Diagonale anheben ----------
    let BR = null;
    if (MAP.bridge) {
      const B = MAP.bridge;
      let ci = -1, cj = -1;
      for (let i = 0; i < N && ci < 0; i++) for (let j = i + 60; j < N; j++) {
        if (N - j + i < 60) continue;
        const a = S[i], b = S[(i + 1) % N], c = S[j], d = S[(j + 1) % N];
        const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
        if (t >= 0 && t < 1 && u >= 0 && u < 1) { ci = i; cj = j; break; }
      }
      if (ci >= 0) {
        const sc = S[ci].s, L = path.len;
        const ds = (p) => { let d = Math.abs(p.s - sc); return Math.min(d, L - d); };
        for (const p of S) {
          const d = ds(p);
          p.y = d <= B.flat ? B.h : d < B.flat + B.ramp ? B.h * 0.5 * (1 + Math.cos(Math.PI * (d - B.flat) / B.ramp)) : 0;
          p.bd = d;                                  // Abstand zur Brückenmitte (entlang der oberen Strecke)
        }
        for (let i = 0; i < N; i++) S[i].gy = (S[(i + 1) % N].y - S[(i - 1 + N) % N].y) / (S[(i + 1) % N].s - S[(i - 1 + N) % N].s || 2);   // Steigung
        BR = Object.assign({ upper: ci, lower: cj, x: S[ci].x, z: S[ci].z }, B);
      }
    }
    // ---------- Bergpass: Höhenprofil aus den Stützpunkten, geglättet, kleine Kuppen und Senken ----------
    if (MAP.mountain) {
      const C = MAP.ctrl, K = C.length, L = path.len, ks = path.ks;
      let k = 0;
      const raw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const s = S[i].s;
        while (k < K - 1 && ks[k + 1] <= s) k++;
        const s0 = ks[k], s1 = k < K - 1 ? ks[k + 1] : L, y0 = C[k][2], y1 = C[(k + 1) % K][2];
        raw[i] = y0 + (y1 - y0) * (s - s0) / Math.max(1e-6, s1 - s0);
      }
      const sm = (src, r) => { const out = new Float32Array(N); let acc = 0; for (let j = -r; j <= r; j++) acc += src[(j + N) % N]; for (let i = 0; i < N; i++) { out[i] = acc / (2 * r + 1); acc += src[(i + r + 1) % N] - src[(i - r + N) % N]; } return out; };
      const ys = sm(sm(raw, 30), 30);
      const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let i = 0; i < N; i++) {
        const s = S[i].s, q = s < L / 2 ? s : s - L;
        const flat = q >= 0 ? ss(240, 420, q) : ss(140, 300, -q);   // Start/Ziel und Boxeneinfahrt bleiben eben auf Talhöhe
        S[i].y = flat * (ys[i] + 2.6 * Math.sin(s / 83) + 1.4 * Math.sin(s / 31 + 1.7));
      }
      for (let i = 0; i < N; i++) S[i].gy = (S[(i + 1) % N].y - S[(i - 1 + N) % N].y) / ((S[(i + 1) % N].s - S[(i - 1 + N) % N].s + L) % L || 2);
    }
    const ELEV = !!BR || !!MAP.mountain;
    const toon = E46.toon;
    const world = new T.Group(); scene.add(world);
    // Zebrastreifen (nur wenn die Map einen hat): Mittelpunkt auf der Strecke
    const cross = MAP.crossing != null ? S[MAP.crossing] : null, CROSS_HALF = 2.2;

    // ---------- befahrbare Flächen ----------
    const main = corridorShape(path, WALL - WALL_T / 2);
    const pitPath = buildPath(MAP.pit, false, 1.0);
    const pit = corridorShape(pitPath, PIT_HW);
    const H = MAP.hall, Y = MAP.yard;
    const hall = rectShape(H), yard = rectShape(Y);
    const doorW = 7;
    const dcx = (H.x0 + H.x1) / 2 - 4;
    const door = rectShape({ x0: dcx - doorW, x1: dcx + doorW, z0: H.z1 - 0.5, z1: Y.z0 + 0.5 });
    // Übergangsflächen dort, wo die Boxengasse die Rennstrecke bzw. den Hof verlässt
    // (sonst entstehen an den Ecken der Mauerlücke unsichtbare Kanten)
    const joins = [];
    {
      const PS = pitPath.S;
      let ti = PS.findIndex(p => main.sd(p.x, p.z).d < 0);
      if (ti < 0) ti = PS.length - 1;
      const pj = PS[Math.max(0, ti - 2)];
      joins.push(circleShape(pj.x, pj.z, PIT_HW + 6));
      let yi = PS.findIndex(p => yard.sd(p.x, p.z).d > 0);
      if (yi >= 0) joins.push(circleShape(PS[yi].x, PS[yi].z, PIT_HW + 3.5));
    }
    const areas = [main, pit, hall, yard, door, ...joins];
    const obstacles = [];
    // Tankstelle: Zapfsäulen-Inseln, Shop
    const pumps = [];
    if (MAP.gas) {
      const g = MAP.gas;
      for (let i = 0; i < 3; i++) {
        const ix = g.cx - 9 + i * 9;
        obstacles.push(rectShape({ x0: ix - 0.75, x1: ix + 0.75, z0: g.cz - 3, z1: g.cz + 3 }));
        for (const sd of [-1, 1]) pumps.push({ x0: ix + sd * 1.0 - (sd < 0 ? 3.2 : 0), x1: ix + sd * 1.0 + (sd > 0 ? 3.2 : 0), z0: g.cz - 4, z1: g.cz + 4 });
      }
      obstacles.push(rectShape({ x0: g.cx + 14, x1: g.cx + 26, z0: Y.z0 + 1, z1: Y.z0 + 11 }));   // Shop
      for (const [px, pz] of [[g.cx - 13, g.cz - 5], [g.cx + 13, g.cz - 5], [g.cx - 13, g.cz + 5], [g.cx + 13, g.cz + 5]]) obstacles.push(rectShape({ x0: px - 0.3, x1: px + 0.3, z0: pz - 0.3, z1: pz + 0.3 }));
    }
    // Pfosten der Hebebühne, Preismast
    { const L = MAP.lift, lcz = (L.z0 + L.z1) / 2; for (const sx of [L.x0 - 0.35, L.x1 + 0.35]) obstacles.push(rectShape({ x0: sx - 0.25, x1: sx + 0.25, z0: lcz - 0.25, z1: lcz + 0.25 })); }
    if (MAP.gas) obstacles.push(rectShape({ x0: MAP.gas.cx - 23.2, x1: MAP.gas.cx - 20.8, z0: Y.z1 - 2.4, z1: Y.z1 - 1.6 }));
    // kombinierter Abstand (negativ = befahrbar)
    function sdAll(x, z, hints, skip) {
      let best = { d: 1e9, gx: 0, gz: 0 }, bi = -1;
      for (let k = 0; k < areas.length; k++) {
        if (areas[k] === skip) continue;
        const r = areas[k].sd(x, z, hints ? hints[k] : undefined);
        if (hints && r.i != null) hints[k] = r.i;
        if (r.d < best.d) { best = r; bi = k; }
      }
      for (const o of obstacles) {
        const r = o.sd(x, z);
        if (-r.d > best.d) best = { d: -r.d, gx: -r.gx, gz: -r.gz };
      }
      return best;
    }
    const inOther = (x, z, self, margin) => { for (const a of areas) if (a !== self && a.sd(x, z).d < -(margin || 0)) return true; return false; };

    // ---------- Himmel & Licht (Tageszeit) ----------
    const sky = Sky.create(W);
    world.add(sky.group);
    scene.fog = sky.fog;
    const sunL = sky.sun, sunDir = sky.lightDir;
    // Nacht: Materialien, die vom Flutlicht angestrahlt werden (leuchten leicht mit ihrer eigenen Textur),
    // und Dinge, die nur bei Dunkelheit zu sehen sind (Lichtkegel, Lichtflecken)
    const nightLit = [], nightGlow = [];
    const lit = (m, amt) => { m.emissive = m.map ? new T.Color(0xffffff) : m.color.clone(); if (m.map) m.emissiveMap = m.map; m.emissiveIntensity = 0; nightLit.push([m, amt]); return m; };
    const glowTex = canvasTex(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
    glowTex.wrapS = glowTex.wrapT = T.ClampToEdgeWrapping;
    // Lichtfleck am Boden (additiv), nur nachts sichtbar
    function pool(x, z, r, color, k, y) {
      const m = new T.MeshBasicMaterial({ map: glowTex, color: color || 0xfff0cf, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false });
      const o = new T.Mesh(new T.PlaneGeometry(r * 2, r * 2), m);
      o.rotation.x = -Math.PI / 2; o.position.set(x, y || 0.06, z); o.renderOrder = 3; o.visible = false; world.add(o);
      nightGlow.push([o, k == null ? 0.5 : k]); return o;
    }
    // Leuchtpunkt (blendet nachts), z. B. an Lampen
    function flare(x, y, z, size, color, k) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: color || 0xfff3d8, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      sp.position.set(x, y, z); sp.scale.set(size, size, 1); sp.visible = false; world.add(sp);
      nightGlow.push([sp, k == null ? 0.9 : k]); return sp;
    }

    // ---------- Boden ----------
    const grassTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#6fa94a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#79b454'; g.fillRect(0, 0, w / 2, h);                      // Mähstreifen
      noise(g, w, h, 3200, '#659d43', '#84bd5c', 3);
      noise(g, w, h, 900, '#5a9140', '#93c866', 2);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 3 ? 'rgba(60,120,45,0.22)' : 'rgba(150,170,70,0.16)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 14 + Math.random() * 30, 0, 7); g.fill(); }
    }, [260 * W, 260 * W]);
    const ground = new T.Mesh(new T.CircleGeometry(1400 * W, 64), toon(0xffffff, { map: grassTex, side: T.FrontSide }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);

    // ---------- Streckenraster: schnelle Abstandsabfrage zur Strecke (Gelände, Bäume) ----------
    const CELL = 24, grid = new Map(), gk = (cx, cz) => cx * 73856 + cz;
    for (let i = 0; i < N; i += 2) { const k = gk(Math.floor(S[i].x / CELL), Math.floor(S[i].z / CELL)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); }
    function forNear(x, z, r, fn) {
      const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
      for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) { const a = grid.get(gk(cx, cz)); if (a) for (const i of a) fn(i); }
    }
    function distFast(x, z, r) {
      let best = r * r; forNear(x, z, r, (i) => { const dx = x - S[i].x, dz = z - S[i].z, d = dx * dx + dz * dz; if (d < best) best = d; });
      return Math.sqrt(best);
    }

    // ---------- Berggelände (nur Bergpass): Höhe folgt der Straße, dazwischen und außen Bergflanken ----------
    let terrainH = null;
    if (MAP.mountain) {
      ground.position.y = -8;   // flache Grasebene weit unter der Talstraße (die Straße geht dort bis ca. -0,7 m runter)
      let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
      for (const p of S) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z); }
      const M = 460, G = 7;
      const gx0 = bx0 - M, gz0 = bz0 - M, nx = Math.ceil((bx1 - bx0 + 2 * M) / G) + 1, nz = Math.ceil((bz1 - bz0 + 2 * M) / G) + 1;
      const hs = new Float32Array(nx * nz);
      const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const hash = (x, z) => { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); };
      const vnoise = (x, z) => {
        const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
        const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
      const fbm = (x, z) => vnoise(x / 160, z / 160) * 0.6 + vnoise(x / 60 + 7, z / 60 + 3) * 0.28 + vnoise(x / 22 + 1, z / 22 + 9) * 0.12;
      // grobe Stützpunkte für das Innere der Schleife
      const coarse = []; for (let i = 0; i < N; i += 30) coarse.push(S[i]);
      // innen/außen je Rasterzeile (Schnittpunkte mit dem Streckenpolygon)
      const inside = new Uint8Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        const z = gz0 + j * G, xs = [];
        for (let i = 0; i < N; i += 2) { const a = S[i], b = S[(i + 2) % N]; if ((a.z > z) !== (b.z > z)) xs.push(a.x + (z - a.z) / (b.z - a.z) * (b.x - a.x)); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil((xs[k] - gx0) / G)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - gx0) / G)); for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1; }
      }
      const R = 110, R2 = R * R, padR = { x0: 30, x1: 140, z0: -80, z1: 70 };
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = gx0 + i * G, z = gz0 + j * G;
        let w4s = 0, y4 = 0, w8s = 0, y8 = 0, dmin = 1e18;
        forNear(x, z, R, (k) => {
          const p = S[k], dx = x - p.x, dz = z - p.z, dd = dx * dx + dz * dz;
          if (dd > R2) return;
          if (dd < dmin) dmin = dd;
          const f = 1 - dd / R2, d2 = dd + 1, w4 = f * f / (d2 * d2), w8 = w4 * w4 / (f * f);
          w4s += w4; y4 += w4 * p.y; w8s += w8; y8 += w8 * p.y;
        });
        const d = Math.sqrt(dmin), ins = inside[j * nx + i];
        // Fernfeld: innen weich zwischen den Straßenhöhen interpoliert + Bergrücken, außen fällt das Gelände ab
        let wf = 0, yf = 0;
        for (const p of coarse) { const dx = x - p.x, dz = z - p.z, w = 1 / (dx * dx + dz * dz + 400); wf += w; yf += w * p.y; }
        yf /= wf;
        const n = fbm(x, z);
        let far;
        if (ins) far = yf + 38 * ss(40, 260, d) + (n - 0.5) * 26;
        else { const yn = w4s > 0 ? y4 / w4s : yf; far = (Math.min(yn, yf + 40)) * Math.exp(-Math.max(0, d - 30) / 260) + n * 55 * ss(60, 300, d); }
        let y;
        if (w8s > 0) {
          const yRoad = y8 / w8s, yNear = y4 / w4s;
          y = yRoad - 0.4 + (yNear - yRoad + 0.4) * ss(WALL + 3, WALL + 14, d);
          y += (far - y) * ss(25, 140, d);
        } else y = far;
        // Werkstatt, Hof und Boxengasse liegen auf Talhöhe
        if (x > padR.x0 && x < padR.x1 && z > padR.z0 && z < padR.z1) {
          const dp = Math.min(hall.sd(x, z).d, yard.sd(x, z).d, door.sd(x, z).d, pit.sd(x, z).d);
          y += (-0.08 - y) * (1 - ss(3, 24, dp));
        }
        // zum Rand hin auf den flachen Boden auslaufen
        const e = Math.min(i, j, nx - 1 - i, nz - 1 - j) * G;
        y += (-7.8 - y) * (1 - ss(0, 170, e));
        hs[j * nx + i] = y;
      }
      terrainH = (x, z) => {
        const fx = (x - gx0) / G, fz = (z - gz0) / G, i = Math.floor(fx), j = Math.floor(fz);
        if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return 0;
        const u = fx - i, v = fz - j, a = hs[j * nx + i], b = hs[j * nx + i + 1], c = hs[(j + 1) * nx + i], d = hs[(j + 1) * nx + i + 1];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
      // Geometrie mit Farben nach Steilheit und Höhe (Wiese, Fels, Almwiese)
      const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
      const cGrass = new T.Color(0x6aa548), cGrass2 = new T.Color(0x4f8f3d), cAlp = new T.Color(0x9fbf5a), cRock = new T.Color(0x8d8a83), cRock2 = new T.Color(0x6f6d68), cc = new T.Color();
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, y = hs[k];
        pos[k * 3] = gx0 + i * G; pos[k * 3 + 1] = y; pos[k * 3 + 2] = gz0 + j * G;
        const sx = (hs[j * nx + Math.min(nx - 1, i + 1)] - hs[j * nx + Math.max(0, i - 1)]) / (2 * G), sz = (hs[Math.min(nz - 1, j + 1) * nx + i] - hs[Math.max(0, j - 1) * nx + i]) / (2 * G);
        const slope = Math.hypot(sx, sz), n = hash(i * 0.37, j * 0.61);
        cc.copy(cGrass).lerp(cGrass2, n * 0.6).lerp(cAlp, ss(120, 230, y) * 0.7).lerp(n > 0.5 ? cRock : cRock2, ss(0.75, 1.15, slope));
        col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
      }
      let t = 0;
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
      }
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.BufferAttribute(pos, 3)); tg.setAttribute('color', new T.BufferAttribute(col, 3));
      tg.setIndex(new T.BufferAttribute(idx, 1)); tg.computeVertexNormals();
      const tm = toon(0xffffff, { vertexColors: true, side: T.FrontSide }); tm.flatShading = true;
      const terr = new T.Mesh(tg, tm); terr.receiveShadow = true; world.add(terr);
    }

    // ---------- Band-Geometrie entlang eines Pfades ----------
    function ribbon(P, o0, o1, y0, y1, vScale, mat, filter) {
      const SS = P.S, NN = SS.length, loop = P.closed;
      const pos = [], uv = [], idx = [];
      let vi = 0, open = false;
      const last = loop ? NN : NN - 1;
      for (let i = 0; i <= last; i++) {
        const p = SS[i % NN];
        const ok = !filter || filter(i % NN, p);
        if (!ok) { open = false; continue; }
        const py = p.y || 0; pos.push(p.x + p.rx * o0, y0 + py, p.z + p.rz * o0, p.x + p.rx * o1, y1 + py, p.z + p.rz * o1);
        const v = (loop && i === NN ? P.len : p.s) / vScale;
        uv.push(0, v, 1, v);
        if (open) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
        vi += 2; open = true;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new T.Mesh(g, mat); m.receiveShadow = true; world.add(m); return m;
    }
    const asphaltTex = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#45484d'; g.fillRect(0, 0, w, h);
      noise(g, w, h, 11000, '#3e4146', '#505358', 2);
      noise(g, w, h, 2500, '#36393d', '#5b5e63', 1);
      // dunkle Gummispur in der Mitte (Ideallinie) und zwei Fahrspuren
      const band = (x, bw, a) => { const gr = g.createLinearGradient(x - bw, 0, x + bw, 0); gr.addColorStop(0, 'rgba(20,21,24,0)'); gr.addColorStop(0.5, 'rgba(20,21,24,' + a + ')'); gr.addColorStop(1, 'rgba(20,21,24,0)'); g.fillStyle = gr; g.fillRect(x - bw, 0, bw * 2, h); };
      band(w / 2, 70, 0.34); band(w * 0.36, 16, 0.18); band(w * 0.64, 16, 0.18);
      // Flicken und feine Risse
      for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(30,32,36,0.22)'; g.fillRect(20 + Math.random() * (w - 90), Math.random() * h, 24 + Math.random() * 40, 14 + Math.random() * 30); }
      g.strokeStyle = 'rgba(22,23,26,0.5)'; g.lineWidth = 1;
      for (let i = 0; i < 7; i++) { let x = 20 + Math.random() * (w - 40), y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 16; y += 6 + Math.random() * 12; g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = '#f0f0ee'; g.fillRect(6, 0, 7, h); g.fillRect(w - 13, 0, 7, h);
    });
    asphaltTex.wrapS = T.ClampToEdgeWrapping;
    const asphaltMat = lit(toon(0xffffff, { map: asphaltTex, side: T.FrontSide }), 0.42);
    ribbon(path, -ROAD, ROAD, 0.02, 0.02, 24, asphaltMat);
    const concreteTex = canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#8b8d8c'; g.fillRect(0, 0, w, h); noise(g, w, h, 3600, '#828483', '#979998', 2);
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(60,60,58,0.12)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 22, 0, 7); g.fill(); }
      g.fillStyle = '#777978'; g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2, w, 2);
    });
    const concMat = lit(toon(0xffffff, { map: concreteTex, side: T.FrontSide }), 0.34);
    ribbon(path, ROAD, RUNOFF + 0.6, 0.015, 0.015, 12, concMat);
    ribbon(path, -RUNOFF - 0.6, -ROAD, 0.015, 0.015, 12, concMat);
    const curbTex = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h); g.fillStyle = '#d42a2a'; g.fillRect(0, 0, w, h / 2); });
    const curbMat = lit(toon(0xffffff, { map: curbTex, side: T.FrontSide }), 0.48);
    const isCurve = (i) => { let m = 0; for (let k = -6; k <= 6; k++) m = Math.max(m, Math.abs(S[(i + k + N) % N].k)); return m > 1 / 75; };
    ribbon(path, ROAD - 0.2, ROAD + 1.4, 0.035, 0.035, 4, curbMat, isCurve);
    ribbon(path, -ROAD - 1.4, -ROAD + 0.2, 0.035, 0.035, 4, curbMat, isCurve);
    // Boxengasse
    const pitTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#505358'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, '#4a4d52', '#5a5d62', 2);
      g.fillStyle = '#f2f2f2'; g.fillRect(4, 0, 6, h); g.fillRect(w - 10, 0, 6, h);
      g.fillStyle = '#ffd21f'; for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 3, y, 6, 34);
    });
    pitTex.wrapS = T.ClampToEdgeWrapping;
    ribbon(pitPath, -PIT_HW, PIT_HW, 0.024, 0.024, 10, lit(toon(0xffffff, { map: pitTex, side: T.FrontSide }), 0.42), (i, p) => main.sd(p.x, p.z).d > -2);

    for (const j of joins) {
      const disc = new T.Mesh(new T.CircleGeometry(j.r + 0.3, 40), concMat);
      disc.rotation.x = -Math.PI / 2; disc.position.set(j.cx, 0.012, j.cz); disc.receiveShadow = true; world.add(disc);
    }
    // ---------- Mauern mit Werbebannern (mit Lücken an Einfahrten) ----------
    const words = ['E46 TOURING', 'SIDEWAYS', 'DRIFT CUP', 'SMOKE SHOW', 'M54', MAP.name.toUpperCase(), 'FULL LOCK', 'NO GRIP'];
    const wallTex = canvasTex(2048, 48, (g, w, h) => {
      const cols = [['#ffffff', '#d32b2b'], ['#1f4fa8', '#ffffff'], ['#f2c21b', '#1a1a1a'], ['#ffffff', '#1a1a1a']];
      for (let i = 0; i < 8; i++) {
        const c = cols[i % 4]; g.fillStyle = c[0]; g.fillRect(i * 256, 0, 256, h);
        g.fillStyle = c[1]; g.font = 'italic 900 24px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(words[i], i * 256 + 128, h / 2 + 1, 230);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * 256, 0, 3, h);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(i * 256, h - 5, 256, 5);
      }
    });
    // Banner zeigen zur Strecke; die Rückseite ist blanker Beton (sonst stünde die Schrift dort spiegelverkehrt)
    const wallFaceF = lit(toon(0xffffff, { map: wallTex, side: T.FrontSide }), 0.4), wallFaceB = lit(toon(0xffffff, { map: wallTex, side: T.BackSide }), 0.4);
    const wallBackF = toon(0xa9aba8, { side: T.FrontSide }), wallBackB = toon(0xa9aba8, { side: T.BackSide });
    const wallTop = lit(toon(0xb9bbbd, { side: T.DoubleSide }), 0.2);
    const plainWall = lit(toon(0xcfcdc6, { side: T.DoubleSide }), 0.2);
    // Mauer entlang eines Pfades auf Abstand off; Lücke wo eine andere Fläche anschließt
    function pathWall(P, off, self, h, mat, texScale) {
      const SS = P.S, NN = SS.length, last = P.closed ? NN : NN - 1, sg = Math.sign(off);
      const wpos = [], wuv = [], widx = [], tpos = [], tidx = [];
      let vi = 0, open = false;
      for (let i = 0; i <= last; i++) {
        const p = SS[i % NN];
        const a = off - sg * WALL_T / 2, b = off + sg * WALL_T / 2;
        const ax = p.x + p.rx * a, az = p.z + p.rz * a, bx = p.x + p.rx * b, bz = p.z + p.rz * b;
        const mx = p.x + p.rx * (off - sg * 1.2), mz = p.z + p.rz * (off - sg * 1.2);
        if (inOther(mx, mz, self, 0.3) || inOther(p.x + p.rx * (off + sg * 1.2), p.z + p.rz * (off + sg * 1.2), self, 0.3)) { open = false; continue; }
        if (cross && self === main && Math.abs(p.s - cross.s) < CROSS_HALF) { open = false; continue; }   // Durchgang für Fußgänger
        const u = (P.closed && i === NN ? P.len : p.s) / (texScale || 64) * (sg > 0 ? -1 : 1);
        const yb = p.y || 0;
        wpos.push(ax, yb, az, ax, yb + h, az); wuv.push(u, 0, u, 1);
        tpos.push(ax, yb + h, az, bx, yb + h, bz);
        if (open) { widx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1); tidx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1); }
        vi += 2; open = true;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(wpos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(wuv, 2));
      g.setIndex(widx); g.computeVertexNormals();
      if (mat === 'banner') {
        // die Vorderseite der Dreiecke zeigt nach rechts: rechte Mauer -> Banner auf die Rückseite
        const f = new T.Mesh(g, sg > 0 ? wallFaceB : wallFaceF); f.receiveShadow = true; world.add(f);
        world.add(new T.Mesh(g, sg > 0 ? wallBackF : wallBackB));
      } else { const m = new T.Mesh(g, mat); m.receiveShadow = true; world.add(m); }
      if (mat && mat.alphaTest) return;   // Leitplanke: keine Mauerkrone
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.Float32BufferAttribute(tpos, 3));
      tg.setIndex(tidx); tg.computeVertexNormals();
      world.add(new T.Mesh(tg, wallTop));
    }
    if (MAP.mountain) {
      // Bergpass: verzinkte Leitplanke mit Pfosten und rot-weißen Leitpfosten statt Werbebanden
      const railTex = canvasTex(256, 64, (g, w, h) => {
        g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
        g.fillStyle = '#5b5f63'; for (const x of [10, 138]) g.fillRect(x, 0, 12, h);                  // Pfosten
        const gr = g.createLinearGradient(0, 14, 0, 40); gr.addColorStop(0, '#e3e6e8'); gr.addColorStop(0.35, '#9aa0a5'); gr.addColorStop(0.6, '#d5d9dc'); gr.addColorStop(1, '#7d8388');
        g.fillStyle = gr; g.fillRect(0, 14, w, 26);                                                   // Planke
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 26, w, 2);
        g.fillStyle = '#f4f4f2'; g.fillRect(232, 0, 10, h); g.fillStyle = '#d42a2a'; g.fillRect(232, 2, 10, 8);   // Leitpfosten
      });
      const railMat = lit(toon(0xffffff, { map: railTex, transparent: true, alphaTest: 0.5, side: T.DoubleSide }), 0.3);
      pathWall(path, WALL, main, WALL_H, railMat, 16);
      pathWall(path, -WALL, main, WALL_H, railMat, 16);
    } else {
      pathWall(path, WALL, main, WALL_H, 'banner');
      pathWall(path, -WALL, main, WALL_H, 'banner');
    }
    if (BR) buildBridge();
    pathWall(pitPath, PIT_HW + 0.25, pit, 0.8, plainWall, 8);
    pathWall(pitPath, -PIT_HW - 0.25, pit, 0.8, plainWall, 8);
    // Brücke: Rampen als Damm mit Betonwänden, in der Mitte ein freies Feld (Fahrbahnplatte) über der unteren Strecke
    function buildBridge() {
      const B = BR, side = WALL + WALL_T / 2 + 0.02;
      const damM = lit(toon(0xb4b2aa, { side: T.DoubleSide }), 0.2), deckM = lit(toon(0x8f918f, { side: T.DoubleSide }), 0.15);
      const girderM = toon(0x5d636b), railM = lit(toon(0xd32b2b), 0.3);
      const idx = []; for (let i = 0; i < N; i++) if (S[i].y > 0.02) idx.push(i);
      // Seitenwände des Damms bzw. Stirnseite der Platte
      for (const sg of [1, -1]) {
        const pos = [], ind = []; let vi = 0, prev = -2;
        for (const i of idx) {
          const p = S[i], open = p.bd < B.span, yb = open ? p.y - B.deck : 0;
          pos.push(p.x + p.rx * sg * side, yb, p.z + p.rz * sg * side, p.x + p.rx * sg * side, p.y, p.z + p.rz * sg * side);
          if (prev === i - 1) ind.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
          prev = i; vi += 2;
        }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
        const m = new T.Mesh(g, damM); m.castShadow = true; m.receiveShadow = true; world.add(m);
      }
      // Unterseite der Fahrbahnplatte (wirft Schatten auf die untere Strecke)
      ribbon(path, -side, side, -B.deck + 0.01, -B.deck + 0.01, 12, deckM, (i, p) => p.bd < B.span + 0.5).castShadow = true;
      // Stirnwände (Widerlager) zur unteren Strecke hin
      for (const dir of [-1, 1]) {
        let i = B.upper; while (S[(i + N) % N].bd < B.span) i += dir; i = (i + N) % N;
        const p = S[i], hdg = Math.atan2(-p.tz, p.tx), hgt = p.y - B.deck;
        const ab = new T.Mesh(new T.BoxGeometry(1.2, hgt, 2 * side), damM);
        ab.position.set(p.x + p.tx * dir * 0.6, hgt / 2, p.z + p.tz * dir * 0.6); ab.rotation.y = hdg; ab.castShadow = true; ab.receiveShadow = true; world.add(ab);
      }
      // Stahlträger unter der Platte und rote Geländerleiste oben auf den Brüstungen
      {
        const p = S[B.upper], hdg = Math.atan2(-p.tz, p.tx);
        for (const lat of [-8, -3, 3, 8]) {
          const gb = new T.Mesh(new T.BoxGeometry(2 * B.span + 1, 0.7, 0.45), girderM);
          gb.position.set(p.x + p.rx * lat, p.y - B.deck - 0.35, p.z + p.rz * lat); gb.rotation.y = hdg; gb.castShadow = true; world.add(gb);
        }
        for (const sg of [1, -1]) {
          const rl = new T.Mesh(new T.BoxGeometry(2 * (B.flat + 6), 0.1, WALL_T + 0.04), railM);
          rl.position.set(p.x + p.rx * sg * WALL, p.y + WALL_H + 0.05, p.z + p.rz * sg * WALL); rl.rotation.y = hdg; world.add(rl);
        }
        // Schild über der unteren Durchfahrt
        const lp = S[B.lower], lh = Math.atan2(-lp.tz, lp.tx);
        const sgT = textTex('BRÜCKE · ' + B.h.toFixed(0) + ' m', 1024, 128, '#1c69d4', '#ffffff', 'italic 900 80px Arial Black, Arial');
        for (const sd of [1, -1]) {
          const sgn = new T.Mesh(new T.PlaneGeometry(14, 1.75), new T.MeshBasicMaterial({ map: sgT }));
          sgn.position.set(p.x - lp.tx * sd * (side + 0.05), p.y - B.deck - 1.0, p.z - lp.tz * sd * (side + 0.05));
          sgn.rotation.y = lh + (sd > 0 ? -Math.PI / 2 : Math.PI / 2); world.add(sgn);
        }
      }
    }
    // Rechteck-Umrandung (Hof) mit Lücken
    function rectWall(R, self, h, mat) {
      const e = 0.25, pts = [[R.x0 - e, R.z0 - e], [R.x1 + e, R.z0 - e], [R.x1 + e, R.z1 + e], [R.x0 - e, R.z1 + e]];
      for (let k = 0; k < 4; k++) {
        const A = pts[k], B = pts[(k + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.ceil(L / 1.0);
        let start = null;
        const flush = (endT) => {
          if (start == null) return;
          const sx = A[0] + (B[0] - A[0]) * start, sz = A[1] + (B[1] - A[1]) * start, ex = A[0] + (B[0] - A[0]) * endT, ez = A[1] + (B[1] - A[1]) * endT;
          const len = Math.hypot(ex - sx, ez - sz); if (len < 0.3) { start = null; return; }
          const w = new T.Mesh(new T.BoxGeometry(len, h, WALL_T), mat);
          w.position.set((sx + ex) / 2, h / 2, (sz + ez) / 2); w.rotation.y = -Math.atan2(ez - sz, ex - sx);
          w.castShadow = true; w.receiveShadow = true; world.add(w); start = null;
        };
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = A[0] + (B[0] - A[0]) * t, z = A[1] + (B[1] - A[1]) * t;
          const nx = (B[1] - A[1]) / L, nz = -(B[0] - A[0]) / L;          // nach außen
          const blocked = inOther(x + nx * 1.0, z + nz * 1.0, self, 0.3);
          if (blocked) flush(t); else if (start == null) start = t;
        }
        flush(1);
      }
    }
    rectWall(Y, yard, 0.8, plainWall);

    // Zebrastreifen: weiße Balken quer über die Fahrbahn, Gehsteige hinter den Mauerlücken,
    // Poller (das Auto bleibt trotzdem an der unsichtbaren Mauerlinie hängen) und Schilder
    if (cross) {
      const p = cross, hdg = Math.atan2(-p.tz, p.tx);
      const place = (o, along, lat, y) => { o.position.set(p.x + p.tx * along + p.rx * lat, y, p.z + p.tz * along + p.rz * lat); o.rotation.y = hdg; world.add(o); return o; };
      const white = lit(toon(0xf4f4f0, { side: T.FrontSide }), 0.5);
      const stripeG = new T.PlaneGeometry(2 * CROSS_HALF - 0.6, 0.5); stripeG.rotateX(-Math.PI / 2);
      for (let lat = -ROAD + 0.5; lat <= ROAD - 0.5 + 1e-6; lat += 1.0) place(new T.Mesh(stripeG, white), 0, lat, 0.04).receiveShadow = true;
      const walkG = new T.PlaneGeometry(2 * CROSS_HALF, 6.5); walkG.rotateX(-Math.PI / 2);
      const bolG = new T.CylinderGeometry(0.09, 0.09, 0.9, 10), bolM = toon(0xffd21f), bolTop = toon(0x1a1a1a);
      const signTex = canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f5fbf'; g.fillRect(5, 5, w - 10, h - 10);
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(64, 16); g.lineTo(114, 108); g.lineTo(14, 108); g.closePath(); g.fill();
        g.fillStyle = '#111'; for (let i = 0; i < 4; i++) g.fillRect(30 + i * 19, 96, 11, 8);
        g.strokeStyle = '#111'; g.lineWidth = 6; g.lineCap = 'round';
        g.beginPath(); g.arc(66, 44, 6, 0, 7); g.fillStyle = '#111'; g.fill();
        g.beginPath(); g.moveTo(64, 54); g.lineTo(60, 74); g.lineTo(50, 90); g.moveTo(60, 74); g.lineTo(72, 90); g.moveTo(63, 60); g.lineTo(52, 68); g.moveTo(63, 60); g.lineTo(76, 66); g.stroke();
      });
      signTex.wrapS = signTex.wrapT = T.ClampToEdgeWrapping;
      const signM = toon(0xffffff, { map: signTex }), poleM = toon(0x9da3aa);
      for (const sg of [1, -1]) {
        place(new T.Mesh(walkG, concMat), 0, sg * (WALL + 3.0), 0.03).receiveShadow = true;
        for (const along of [-CROSS_HALF, CROSS_HALF]) {
          place(new T.Mesh(bolG, bolM), along, sg * WALL, 0.45).castShadow = true;
          place(new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.12, 10), bolTop), along, sg * WALL, 0.84);
        }
        // Schild „Fußgängerüberweg“, zur Strecke gedreht
        place(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 2.8, 8), poleM), CROSS_HALF + 0.6, sg * (WALL + 0.8), 1.4);
        const sgn = place(new T.Mesh(new T.PlaneGeometry(0.85, 0.85), signM), CROSS_HALF + 0.6, sg * (WALL + 0.8), 2.5);
        sgn.rotation.y = hdg + (sg > 0 ? Math.PI : 0);
      }
    }

    // Start/Ziel
    const startI = 30;
    {
      const p = S[startI];
      const chk = canvasTex(256, 32, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); } });
      chk.wrapS = chk.wrapT = T.ClampToEdgeWrapping;
      const line = new T.Mesh(new T.PlaneGeometry(2 * ROAD, 2), toon(0xffffff, { map: chk }));
      line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(-p.tz, p.tx) - Math.PI / 2;
      line.position.set(p.x, 0.03, p.z); world.add(line);
      const post = toon(0x2b2e33);
      for (const sg of [1, -1]) {
        const ps = new T.Mesh(new T.BoxGeometry(0.6, 7, 0.6), post);
        ps.position.set(p.x + p.rx * sg * (WALL + 0.6), 3.5, p.z + p.rz * sg * (WALL + 0.6)); ps.castShadow = true; world.add(ps);
      }
      const banTex = canvasTex(1024, 128, (g, w, h) => {
        g.fillStyle = '#d32b2b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 10, w, 6); g.fillRect(0, h - 16, w, 6);
        g.font = 'italic 900 78px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(MAP.name.toUpperCase() + '  ·  START', w / 2, h / 2 + 3, w - 40);
      });
      banTex.wrapS = T.ClampToEdgeWrapping;
      const beam = new T.Mesh(new T.BoxGeometry(2 * WALL + 1.8, 1.8, 0.5), [post, post, post, post, toon(0xffffff, { map: banTex }), toon(0xffffff, { map: banTex })]);
      beam.position.set(p.x, 6.6, p.z); beam.rotation.y = Math.atan2(-p.tz, p.tx) - Math.PI / 2; beam.castShadow = true; world.add(beam);
      // Fahnen entlang der Startgeraden (gegenüber der Tribüne)
      const flagCols = [0xe2252b, 0xffffff, 0x1c3f94, 0xffd21f, 0x6fb5ff, 0x2f8f5a, 0xe2252b, 0xffffff];
      const poleM = toon(0xc9ced4), hdg = Math.atan2(-p.tz, p.tx);
      for (let i = 0; i < 8; i++) {
        const along = -30 + i * 16, fx = p.x + p.tx * along - p.rx * (WALL + 2.2), fz = p.z + p.tz * along - p.rz * (WALL + 2.2);
        if (sdAll(fx, fz).d < 1.2) continue;
        const pole = new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 7, 8), poleM); pole.position.set(fx, 3.5, fz); pole.castShadow = true; world.add(pole);
        const fl = new T.Mesh(new T.PlaneGeometry(2.2, 1.3, 6, 1), toon(flagCols[i]));
        const fp = fl.geometry.attributes.position; for (let k = 0; k < fp.count; k++) fp.setZ(k, Math.sin(fp.getX(k) * 2.6 + i) * 0.14);
        fl.geometry.computeVertexNormals(); fl.geometry.translate(1.1, 0, 0);
        fl.position.set(fx, 6.2, fz); fl.rotation.y = hdg + 0.5 + (i % 3) * 0.15; fl.castShadow = true; world.add(fl);
      }
    }

    let liftCtl = null;
    // ---------- Hof, Werkstatthalle, Hebebühne ----------
    {
      const hcx = (H.x0 + H.x1) / 2, hcz = (H.z0 + H.z1) / 2, L = MAP.lift;
      const yardTex = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#585b61'; g.fillRect(0, 0, w, h); noise(g, w, h, 6000, '#52555b', '#61646a', 2);
        g.strokeStyle = 'rgba(38,40,44,0.6)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();   // Plattenfugen
        g.fillStyle = 'rgba(24,25,27,0.13)'; g.beginPath(); g.ellipse(70, 180, 16, 9, 0.6, 0, 7); g.fill();
        for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)'; g.fillRect((i % 2) * w / 2 + 2, (i >> 1) * h / 2 + 2, w / 2 - 4, h / 2 - 4); }
      }, [(Y.x1 - Y.x0) / 11, (Y.z1 - Y.z0) / 11]);
      const yardM = lit(toon(0xffffff, { map: yardTex, side: T.FrontSide }), 0.36);
      const yp = new T.Mesh(new T.PlaneGeometry(Y.x1 - Y.x0 + 0.5, Y.z1 - Y.z0 + 0.5), yardM);
      yp.rotation.x = -Math.PI / 2; yp.position.set((Y.x0 + Y.x1) / 2, 0.022, (Y.z0 + Y.z1) / 2); yp.receiveShadow = true; world.add(yp);
      // Bodenfarbe (liegt knapp über dem Belag)
      const paint = (c, o) => toon(c, Object.assign({ side: T.FrontSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, o || {}));
      const whiteP = lit(paint(0xe6e6e2), 0.1), yellowP = paint(0xf2c21b);
      const mark = (x, z, w, d, m, y) => { const o = new T.Mesh(new T.PlaneGeometry(w, d), m); o.rotation.x = -Math.PI / 2; o.position.set(x, y || 0.032, z); o.receiveShadow = true; world.add(o); return o; };
      // Parkmarkierungen
      for (let x = Y.x0 + 4; x < Y.x1 - 2; x += 4.5) {
        if (MAP.gas && x > MAP.gas.cx - 18) break;
        mark(x, Y.z1 - 3, 0.15, 5, whiteP);
      }
      // Halle
      const hw = H.x1 - H.x0, hd = H.z1 - H.z0, hh = 6.5, wt = 1.0;
      const hallM = toon(0xc3c7cc), roofM = toon(0x2f3339), darkM = toon(0x2b2e33), wainM = toon(0x3d424b), steelM = toon(0x8d9299);
      const stripeM = lit(toon(0xffd21f), 0.22);
      const floorTex = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#7b8086'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, '#747980', '#84898f', 2); noise(g, w, h, 500, '#676c72', '#9499a0', 1);
        g.strokeStyle = 'rgba(48,52,58,0.55)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
        g.fillStyle = 'rgba(30,31,34,0.1)'; g.beginPath(); g.ellipse(170, 90, 18, 10, 0.5, 0, 7); g.fill();
      }, [hw / 4, hd / 4]);
      const floor = new T.Mesh(new T.PlaneGeometry(hw, hd), toon(0xffffff, { map: floorTex, side: T.FrontSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(hcx, 0.025, hcz); floor.receiveShadow = true; world.add(floor);
      // Boden im Tor (zwischen Halle und Hof) mit Warnstreifen an der Schwelle
      mark(dcx, (H.z1 + Y.z0) / 2, doorW * 2, Y.z0 - H.z1 + 0.6, yardM, 0.024);
      const hazTex = canvasTex(256, 32, (g, w, h) => { g.fillStyle = '#f2c21b'; g.fillRect(0, 0, w, h); g.fillStyle = '#17181b'; for (let i = -1; i < 9; i++) { g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 16, h); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 32, 0); g.fill(); } }, [7, 1]);
      mark(dcx, H.z1 + 0.5, doorW * 2, 0.5, paint(0xffffff, { map: hazTex }));
      // gelbe Linie rund um den Arbeitsbereich und Stellplätze mit Nummern
      mark(hcx, H.z0 + 1.75, hw - 1.6, 0.12, yellowP); mark(H.x0 + 0.8, hcz + 0.5, 0.12, hd - 2.4, yellowP); mark(H.x1 - 0.8, hcz + 0.5, 0.12, hd - 2.4, yellowP);
      {
        const xs = []; for (let i = 0; i < 5; i++) xs.push(H.x0 + 4 + (L.x0 - 3 - H.x0 - 4) * i / 4);
        xs.sort((a, b) => Math.abs(a - dcx) - Math.abs(b - dcx));
        xs.forEach((x, i) => {
          const z = hcz + 0.5;
          mark(x - 1.6, z, 0.1, 5.8, whiteP); mark(x + 1.6, z, 0.1, 5.8, whiteP); mark(x, z - 2.9, 3.3, 0.1, whiteP);
          const nt = canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.fillStyle = '#ecece8'; g.font = '900 52px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), 32, 35); });
          mark(x, z - 3.75, 1.0, 1.0, paint(0xffffff, { map: nt, transparent: true }));
        });
      }
      const addBox = (w, h2, d, x, y, z, m, cast) => { const b = new T.Mesh(new T.BoxGeometry(w, h2, d), m); b.position.set(x, y, z); if (cast) b.castShadow = true; b.receiveShadow = true; world.add(b); return b; };
      addBox(hw + 2 * wt, hh, wt, hcx, hh / 2, H.z0 - wt / 2, hallM, true);                     // Rückwand
      addBox(wt, hh, hd + 2 * wt, H.x0 - wt / 2, hh / 2, hcz, hallM, true);                      // links
      addBox(wt, hh, hd + 2 * wt, H.x1 + wt / 2, hh / 2, hcz, hallM, true);                      // rechts
      const fz = H.z1 + wt / 2;                                                                              // Front mit Tor
      const lw = (dcx - doorW) - (H.x0 - wt), rw = (H.x1 + wt) - (dcx + doorW);
      addBox(lw, hh, wt, (H.x0 - wt) + lw / 2, hh / 2, fz, hallM, true);
      addBox(rw, hh, wt, (dcx + doorW) + rw / 2, hh / 2, fz, hallM, true);
      addBox(doorW * 2, hh - 4.6, wt, dcx, 4.6 + (hh - 4.6) / 2, fz, hallM, true);
      addBox(doorW * 2 + 0.6, 0.3, wt + 0.1, dcx, 4.55, fz, stripeM);
      addBox(hw + 3, 0.5, hd + 3, hcx, hh + 0.25, hcz, roofM, true);
      // dunkler Sockel innen und außen, innen dazu drei Farbstreifen
      const mCols = [toon(0x6fb5ff), toon(0x1c3f94), toon(0xe2252b)];
      addBox(hw, 1.1, 0.06, hcx, 0.55, H.z0 + 0.03, wainM);
      for (const sx of [H.x0 + 0.03, H.x1 - 0.03]) addBox(0.06, 1.1, hd, sx, 0.55, hcz, wainM);
      mCols.forEach((m, i) => {
        addBox(hw, 0.1, 0.05, hcx, 1.3 + i * 0.1, H.z0 + 0.03, m);
        for (const sx of [H.x0 + 0.03, H.x1 - 0.03]) addBox(0.05, 0.1, hd, sx, 1.3 + i * 0.1, hcz, m);
      });
      addBox(lw, 1.0, 0.06, (H.x0 - wt) + lw / 2, 0.5, fz + wt / 2 + 0.03, wainM); addBox(rw, 1.0, 0.06, (dcx + doorW) + rw / 2, 0.5, fz + wt / 2 + 0.03, wainM);
      addBox(lw - wt, 1.1, 0.06, H.x0 + (lw - wt) / 2, 0.55, H.z1 - 0.03, wainM); addBox(rw - wt, 1.1, 0.06, H.x1 - (rw - wt) / 2, 0.55, H.z1 - 0.03, wainM);
      // Rolltor-Kasten über dem Tor, Poller neben der Einfahrt
      addBox(doorW * 2 + 0.8, 0.7, 0.6, dcx, 4.95, H.z1 - 0.32, darkM);
      const bollTex = canvasTex(8, 64, (g, w, h) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#17181b' : '#f2c21b'; g.fillRect(0, i * 16, w, 16); } });
      for (const sx of [-1, 1]) { const b = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 1.0, 12), toon(0xffffff, { map: bollTex })); b.position.set(dcx + sx * (doorW + 0.45), 0.5, fz + 0.75); b.castShadow = true; world.add(b); }
      const sign = new T.Mesh(new T.PlaneGeometry(16, 2.4), new T.MeshBasicMaterial({ map: textTex('WERKSTATT', 1024, 160, '#1c69d4', '#ffffff', 'italic 900 110px Arial Black, Arial') }));
      sign.position.set(dcx, hh - 0.3, fz + wt / 2 + 0.05); world.add(sign);
      // Hallenlicht
      const hl = new T.PointLight(0xfff0d8, 0.62, Math.max(hw, 40), 1.2); hl.position.set(hcx, hh - 1.2, hcz); world.add(hl);
      const hl2 = new T.PointLight(0xfff0d8, 0.4, 30, 1.2); hl2.position.set(L.x0, hh - 1.4, hcz); world.add(hl2);
      // Dachträger und Lichtbänder
      const lampM = new T.MeshBasicMaterial({ color: 0xfffbee });
      addBox(hw, 0.2, 0.2, hcx, hh - 0.3, hcz, darkM);
      for (let x = H.x0 + 5.5; x < H.x1 - 2; x += 5.5) addBox(0.22, 0.42, hd, x, hh - 0.22, hcz, darkM);
      for (let x = H.x0 + 4; x < H.x1 - 2; x += 6) for (const dz of [-3.2, 3.2]) { addBox(2.8, 0.1, 0.34, x, hh - 0.5, hcz + dz, darkM); addBox(2.6, 0.06, 0.24, x, hh - 0.57, hcz + dz, lampM); }
      // Außenlampen über dem Tor, nachts mit Lichtschein auf dem Hof
      for (const sx of [-1, 1]) {
        const lx = dcx + sx * (doorW + 2.2), lz = fz + wt / 2 + 0.18;
        addBox(0.9, 0.16, 0.36, lx, 5.0, lz, darkM); addBox(0.8, 0.06, 0.28, lx, 4.9, lz, lampM);
        flare(lx, 4.85, lz + 0.1, 3.2, 0xffe6b8, 0.8);
      }
      pool(dcx, Y.z0 + 4.5, 13, 0xffe2b0, 0.3);

      // Hebebühne
      const lcx = (L.x0 + L.x1) / 2, lcz = (L.z0 + L.z1) / 2;
      const liftTex = canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#2b2e33'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ffd21f'; g.lineWidth = 10;
        for (let i = -w; i < w * 2; i += 28) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
        g.fillStyle = '#2b2e33'; g.fillRect(14, 14, w - 28, h - 28);
        g.fillStyle = '#ffd21f'; g.font = '900 22px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('LIFT', w / 2, h / 2 + 8);
      });
      liftTex.wrapS = liftTex.wrapT = T.ClampToEdgeWrapping;
      // Bühne liegt bündig im Boden (Räder versinken nicht) und fährt beim Parken samt Auto hoch
      const liftG = new T.Group(); liftG.position.set(lcx, 0, lcz); world.add(liftG);
      const lp = new T.Mesh(new T.BoxGeometry(L.x1 - L.x0, 0.06, L.z1 - L.z0), [toon(0x2b2e33), toon(0x2b2e33), toon(0xffffff, { map: liftTex }), toon(0x2b2e33), toon(0x2b2e33), toon(0x2b2e33)]);
      lp.position.y = 0.0; lp.receiveShadow = true; lp.castShadow = true; liftG.add(lp);
      // Grube unter der Bühne (sieht man, sobald sie hochfährt) und Hydraulikstempel
      const pitM = new T.Mesh(new T.PlaneGeometry(L.x1 - L.x0 - 0.1, L.z1 - L.z0 - 0.1), toon(0x15171a, { side: T.FrontSide }));
      pitM.rotation.x = -Math.PI / 2; pitM.position.set(lcx, 0.027, lcz); world.add(pitM);
      const rams = [];
      for (const dz of [-(L.z1 - L.z0) * 0.3, (L.z1 - L.z0) * 0.3]) {
        const ram = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 1, 14), toon(0xd8dce0)); ram.position.set(lcx, 0.5, lcz + dz); ram.visible = false; world.add(ram); rams.push(ram);
      }
      const postM = toon(0xc62828), carriages = [];
      for (const sx of [L.x0 - 0.35, L.x1 + 0.35]) {
        addBox(0.35, 4.2, 0.35, sx, 2.1, lcz, postM, true);
        addBox(0.7, 0.08, 0.9, sx, 0.04, lcz, darkM);
        const cg = new T.Group(); cg.position.set(sx, 0, lcz); world.add(cg); carriages.push(cg);
        const arm = new T.Mesh(new T.BoxGeometry(0.2, 0.15, 2.4), postM); arm.position.y = 0.1; cg.add(arm);
        const arm2 = new T.Mesh(new T.BoxGeometry(0.42, 0.22, 0.5), darkM); arm2.position.y = 0.1; cg.add(arm2);
      }
      addBox(L.x1 - L.x0 + 1.05, 0.18, 0.3, lcx, 4.25, lcz, postM);                              // Querträger oben
      // Ampel am Pfosten: rot = frei, gelb = stehen bleiben, grün = fährt hoch
      const lampMat = new T.MeshBasicMaterial({ color: 0x8a1010 });
      const lamp = new T.Mesh(new T.SphereGeometry(0.16, 14, 10), lampMat); lamp.position.set(L.x0 - 0.35, 4.55, lcz); world.add(lamp);
      const LAMP = { idle: 0x8a1010, wait: 0xffc21a, up: 0x3dff6a };
      liftCtl = (y, state) => {
        liftG.position.y = y; for (const c of carriages) c.position.y = y;
        for (const r of rams) { r.visible = y > 0.05; r.scale.y = Math.max(0.01, y); r.position.y = y / 2; }
        lampMat.color.setHex(LAMP[state] || LAMP.idle);
      };
      const ls = new T.Mesh(new T.PlaneGeometry(4.6, 1.0), new T.MeshBasicMaterial({ map: textTex('ZUR GARAGE ▶ HIER PARKEN', 512, 112, '#ffd21f', '#111111', '900 44px Arial Black, Arial'), side: T.DoubleSide }));
      ls.position.set(lcx, 4.9, L.z0 - 0.3 + 0.01); world.add(ls);

      // ---------- Einrichtung an der Rückwand (mit Kollision) ----------
      const bz = H.z0, bx = H.x0;
      obstacles.push(rectShape({ x0: bx - 0.5, x1: L.x0 - 1.4, z0: bz - 0.5, z1: bz + 1.25 }));
      obstacles.push(rectShape({ x0: bx - 0.5, x1: bx + 0.7, z0: bz + 1.25, z1: bz + 5.2 }));
      const cyl = (r, h, x, y, z, m, seg) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, h, seg || 16), m); o.position.set(x, y, z); o.castShadow = true; world.add(o); return o; };
      // Reifenregal: zwei Ebenen, Reifen stehen nebeneinander
      {
        const rx = bx + 1.2, n = 12, tw = 0.27;
        const tg = new T.CylinderGeometry(0.34, 0.34, 0.24, 16); tg.rotateZ(Math.PI / 2);
        const im = new T.InstancedMesh(tg, toon(0x1c1d20), n * 2), m4 = new T.Matrix4();
        for (let lv = 0; lv < 2; lv++) for (let i = 0; i < n; i++) { m4.makeTranslation(rx + 0.2 + i * tw, 0.46 + lv * 0.95, bz + 0.55); im.setMatrixAt(lv * n + i, m4); }
        im.castShadow = true; world.add(im);
        const rw2 = n * tw + 0.2;
        for (const px of [rx, rx + rw2]) for (const pz of [bz + 0.2, bz + 0.9]) addBox(0.07, 2.1, 0.07, px, 1.05, pz, steelM);
        for (const y of [0.1, 1.05, 2.05]) for (const pz of [bz + 0.3, bz + 0.8]) addBox(rw2, 0.05, 0.05, rx + rw2 / 2, y, pz, steelM);
      }
      // Werkzeugwagen (rot, mit Schubladen)
      const cabTex = canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#c8262a'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 6; i++) { const y = 6 + i * 20; g.fillStyle = '#8f1519'; g.fillRect(6, y, w - 12, 17); g.fillStyle = '#d6383c'; g.fillRect(8, y + 1, w - 16, 14); g.fillStyle = '#d9dde2'; g.fillRect(34, y + 5, w - 68, 4); }
      });
      const cabF = toon(0xffffff, { map: cabTex }), cabS = toon(0xc8262a);
      for (let i = 0; i < 3; i++) {
        const x = bx + 5.6 + i * 0.98;
        const b = addBox(0.92, 1.05, 0.58, x, 0.6, bz + 0.42, [cabS, cabS, darkM, cabS, cabF, cabS], true);
        for (const dx of [-0.36, 0.36]) cyl(0.05, 0.08, x + dx, 0.04, bz + 0.42, darkM, 8);
      }
      addBox(0.55, 0.24, 0.3, bx + 6.58, 1.25, bz + 0.42, toon(0x1f5fd6), true);
      // Werkbank mit Schraubstock und Lochwand
      {
        const wx = bx + 11.2, wood = toon(0xb07a45);
        addBox(3.4, 0.09, 0.78, wx, 0.93, bz + 0.48, wood, true);
        for (const dx of [-1.6, 1.6]) for (const dz of [0.14, 0.82]) addBox(0.08, 0.9, 0.08, wx + dx, 0.45, bz + dz, darkM);
        addBox(3.2, 0.05, 0.6, wx, 0.3, bz + 0.48, darkM);
        addBox(0.22, 0.16, 0.3, wx + 1.2, 1.06, bz + 0.62, steelM, true); addBox(0.1, 0.22, 0.34, wx + 1.2, 1.2, bz + 0.72, toon(0x1f5fd6)); addBox(0.1, 0.22, 0.34, wx + 1.2, 1.2, bz + 0.5, toon(0x1f5fd6));
        addBox(0.5, 0.3, 0.34, wx - 1.1, 1.13, bz + 0.45, toon(0xd32b2b), true);
        const peg = canvasTex(512, 256, (g, w, h) => {
          g.fillStyle = '#cfc7b4'; g.fillRect(0, 0, w, h);
          g.fillStyle = 'rgba(90,82,66,0.5)'; for (let y = 10; y < h; y += 16) for (let x = 10; x < w; x += 16) g.fillRect(x, y, 2, 2);
          g.lineCap = 'round';
          // Schraubenschlüssel in Reihe
          for (let i = 0; i < 8; i++) { const x = 30 + i * 26, len = 150 - i * 12; g.strokeStyle = '#5d646c'; g.lineWidth = 7; g.beginPath(); g.moveTo(x, 30); g.lineTo(x, 30 + len); g.stroke(); g.lineWidth = 3; g.beginPath(); g.arc(x, 26, 8, 0.4, 5.9); g.stroke(); g.beginPath(); g.arc(x, 34 + len, 7, 0, 7); g.stroke(); }
          // Hammer, Säge, Schraubendreher
          g.strokeStyle = '#8a5a2c'; g.lineWidth = 9; g.beginPath(); g.moveTo(270, 60); g.lineTo(270, 200); g.stroke(); g.fillStyle = '#4a4f56'; g.fillRect(244, 36, 60, 28);
          g.fillStyle = '#9aa1a9'; g.beginPath(); g.moveTo(320, 60); g.lineTo(470, 76); g.lineTo(470, 110); g.lineTo(320, 96); g.fill(); g.fillStyle = '#d98a2b'; g.fillRect(304, 50, 30, 56);
          ['#d32b2b', '#1f5fd6', '#f2c21b', '#2f8f5a', '#d32b2b'].forEach((c, i) => { const x = 336 + i * 30; g.fillStyle = c; g.fillRect(x - 6, 140, 12, 44); g.strokeStyle = '#5d646c'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, 184); g.lineTo(x, 236); g.stroke(); });
          g.strokeStyle = '#3a3f46'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
        });
        const pb = new T.Mesh(new T.PlaneGeometry(3.4, 1.7), toon(0xffffff, { map: peg, side: T.FrontSide })); pb.position.set(wx, 2.15, bz + 0.07); world.add(pb);
      }
      // Lagerregal mit Kisten und Kanistern
      {
        const sx = bx + 15.8, fr = toon(0x3f5f8f), cols = [0xb98a55, 0x2f6fd6, 0xd32b2b, 0xf2c21b, 0x2f8f5a, 0xb98a55, 0x8d9299];
        for (const dx of [-1.4, 1.4]) for (const dz of [0.15, 0.75]) addBox(0.07, 2.6, 0.07, sx + dx, 1.3, bz + dz, fr);
        let k = 0;
        for (const y of [0.25, 0.95, 1.65, 2.35]) {
          addBox(2.9, 0.05, 0.66, sx, y, bz + 0.45, fr);
          for (let x = -1.2; x < 1.15;) {
            const w2 = 0.3 + ((k * 37) % 5) * 0.09, h2 = 0.22 + ((k * 53) % 4) * 0.1;
            if (x + w2 > 1.3) break;
            if (k % 4 === 3) cyl(0.13, 0.34, sx + x + 0.14, y + 0.2, bz + 0.45, toon(cols[k % cols.length]), 10);
            else addBox(w2, Math.min(h2, 0.58), 0.46, sx + x + w2 / 2, y + 0.03 + Math.min(h2, 0.58) / 2, bz + 0.45, toon(cols[k % cols.length]), true);
            x += w2 + 0.07; k++;
          }
        }
      }
      // Ölfässer, Kompressor, Motor auf dem Ständer, Reifenstapel
      [[18.6, 0.45, 0x1f5fd6], [19.3, 0.5, 0xd32b2b], [19.0, 1.0, 0x2f8f5a]].forEach(([dx, dz, c]) => { cyl(0.29, 0.88, bx + dx, 0.44, bz + dz, toon(c)); cyl(0.3, 0.04, bx + dx, 0.3, bz + dz, darkM); cyl(0.3, 0.04, bx + dx, 0.6, bz + dz, darkM); });
      { const cx = bx + 21.8; const t = cyl(0.3, 1.2, cx, 0.52, bz + 0.5, toon(0xf07a1a)); t.rotation.z = Math.PI / 2; addBox(0.5, 0.34, 0.4, cx - 0.1, 0.98, bz + 0.5, darkM, true); cyl(0.14, 0.12, cx + 0.34, 0.98, bz + 0.5, steelM); for (const dx of [-0.4, 0.4]) addBox(0.08, 0.24, 0.5, cx + dx, 0.12, bz + 0.5, darkM); }
      { const ex = bx + 24.6; addBox(0.9, 0.06, 0.7, ex, 0.05, bz + 0.6, darkM); addBox(0.08, 0.8, 0.08, ex - 0.35, 0.45, bz + 0.6, darkM); addBox(0.75, 0.5, 0.48, ex + 0.05, 0.95, bz + 0.6, steelM, true); addBox(0.7, 0.14, 0.3, ex + 0.05, 1.27, bz + 0.6, toon(0xc8262a)); addBox(0.14, 0.4, 0.5, ex + 0.5, 0.95, bz + 0.6, darkM); for (let i = 0; i < 6; i++) cyl(0.03, 0.2, ex - 0.22 + i * 0.11, 1.05, bz + 0.88, toon(0xb0764a), 6).rotation.x = 0.9; }
      {
        const tg = new T.CylinderGeometry(0.34, 0.34, 0.24, 16), tm = toon(0x1c1d20);
        for (const [x, z, n] of [[bx + 27.4, bz + 0.6, 5], [bx + 28.2, bz + 0.6, 3], [bx + 29.0, bz + 0.6, 4]]) for (let k = 0; k < n; k++) { const t = new T.Mesh(tg, tm); t.position.set(x, 0.12 + k * 0.24, z); t.castShadow = true; world.add(t); }
        const rimM = toon(0xc9a33a); for (const [x, y] of [[bx + 27.4, 1.26], [bx + 29.0, 1.02]]) cyl(0.22, 0.1, x, y, bz + 0.6, rimM, 14);
      }
      // Spinde an der linken Wand, Feuerlöscher
      for (let i = 0; i < 6; i++) { addBox(0.5, 1.95, 0.56, bx + 0.3, 0.98, bz + 1.75 + i * 0.58, toon(i % 2 ? 0x4f6f96 : 0x5a7ca6), true); addBox(0.02, 0.5, 0.3, bx + 0.56, 1.5, bz + 1.75 + i * 0.58, darkM); }
      cyl(0.09, 0.5, bx + 0.2, 1.1, H.z1 - 1.4, toon(0xd32b2b), 10);
      // Poster an der Rückwand
      const poster = (x, wd, draw) => {
        const tx = canvasTex(256, 352, (g, w, h) => { draw(g, w, h); g.strokeStyle = '#17181b'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); });
        const o = new T.Mesh(new T.PlaneGeometry(wd, wd * 1.375), toon(0xffffff, { map: tx, side: T.FrontSide })); o.position.set(x, 4.25, bz + 0.04); world.add(o);
      };
      const big = (g, t, y, c, sz) => { g.fillStyle = c; g.font = 'italic 900 ' + sz + 'px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 128, y, 232); };
      poster(bx + 3.0, 1.5, (g, w, h) => { g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd21f'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, 250 + i * 34); g.lineTo(w, 190 + i * 34); g.lineTo(w, 204 + i * 34); g.lineTo(0, 264 + i * 34); g.fill(); } big(g, 'DRIFT', 80, '#ffd21f', 74); big(g, 'CUP', 150, '#ffffff', 74); });
      poster(bx + 6.6, 1.5, (g, w, h) => { g.fillStyle = '#c8262a'; g.fillRect(0, 0, w, h); big(g, 'NO GRIP', 110, '#ffffff', 56); big(g, 'NO', 190, '#17181b', 56); big(g, 'PROBLEM', 260, '#ffffff', 50); });
      poster(bx + 15.8, 1.6, (g, w, h) => {
        g.fillStyle = '#12336e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.arc(128, 150, 86, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
        g.strokeStyle = '#e2252b'; g.beginPath(); g.arc(128, 150, 86, Math.PI * 1.95, Math.PI * 2.25); g.stroke();
        g.strokeStyle = '#ffd21f'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 150); g.lineTo(190, 100); g.stroke(); big(g, 'REDLINE', 296, '#ffffff', 44);
      });
      poster(bx + 20.2, 1.5, (g, w, h) => { g.fillStyle = '#ecece8'; g.fillRect(0, 0, w, h); ['#6fb5ff', '#1c3f94', '#e2252b'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.moveTo(40 + i * 44, 40); g.lineTo(80 + i * 44, 40); g.lineTo(40 + i * 44, 210); g.lineTo(i * 44, 210); g.fill(); }); big(g, 'WER BREMST,', 256, '#17181b', 30); big(g, 'VERLIERT', 300, '#e2252b', 44); });
      poster(bx + 24.6, 1.5, (g, w, h) => { g.fillStyle = '#f2c21b'; g.fillRect(0, 0, w, h); big(g, 'QUER', 100, '#17181b', 76); big(g, 'IST', 176, '#ffffff', 60); big(g, 'MEHR', 256, '#17181b', 76); });
      poster(bx + 28.6, 1.5, (g, w, h) => { g.fillStyle = '#1b1d22'; g.fillRect(0, 0, w, h); big(g, MAP.name.toUpperCase(), 90, '#6ff3ff', 40); g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.lineJoin = 'round'; g.beginPath(); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of S) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } const sc2 = 200 / Math.max(x1 - x0, z1 - z0); for (let i = 0; i <= N; i += 4) { const p = S[i % N], px = 128 + (p.x - (x0 + x1) / 2) * sc2, py = 220 + (p.z - (z0 + z1) / 2) * sc2; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.stroke(); });

      // ---------- Rund um den Hof: Container, Paletten, Laternen ----------
      const corr = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, h); } g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); }, [4, 1]);
      const free = (x, z, m) => sdAll(x, z).d > (m || 3.2);
      const cont = (x, y, z, c, ry) => { if (!free(x, z, 4.2)) return false; const o = addBox(2.5, 2.6, 6.1, x, y + 1.3, z, toon(c, { map: corr }), true); o.rotation.y = ry || 0; return true; };
      for (const sx of [1, -1]) {
        const cxp = sx > 0 ? Y.x1 + 4.6 : Y.x0 - 4.6;
        if (cont(cxp, 0, Y.z0 + 4.5, 0x1f5fa8, 0.06)) { cont(cxp + sx * 0.2, 2.6, Y.z0 + 4.8, 0xd9662b, -0.05); cont(cxp + sx * 3.2, 0, Y.z0 + 5.5, 0x2f8f5a, 0.2); }
        // Paletten-Stapel
        const px = sx > 0 ? Y.x1 + 2.2 : Y.x0 - 2.2, pzz = Y.z0 + 12;
        if (free(px, pzz, 1.2)) for (let k = 0; k < 5; k++) addBox(1.2, 0.14, 0.8, px, 0.08 + k * 0.16, pzz, toon(k % 2 ? 0xb98a55 : 0xa67a48), true);
      }
      // Laternen am Hofrand
      const poleM = toon(0x9da3aa);
      for (const [lx, lz, ix, iz] of [[Y.x0 - 0.9, (Y.z0 + Y.z1) / 2, 1, 0], [Y.x1 + 0.9, (Y.z0 + Y.z1) / 2, -1, 0], [(Y.x0 + Y.x1) / 2, Y.z1 + 0.9, 0, -1]]) {
        if (!free(lx, lz, 0.4)) continue;
        cyl(0.12, 8, lx, 4, lz, poleM, 8);
        addBox(ix ? 1.8 : 0.16, 0.14, iz ? 1.8 : 0.16, lx + ix * 0.9, 7.95, lz + iz * 0.9, poleM);
        addBox(ix ? 0.9 : 0.4, 0.1, iz ? 0.9 : 0.4, lx + ix * 1.7, 7.86, lz + iz * 1.7, lampM);
        flare(lx + ix * 1.7, 7.8, lz + iz * 1.7, 4.5, 0xfff0d0, 0.85);
        pool(lx + ix * 4, lz + iz * 4, 12, 0xfff0d0, 0.28);
      }
    }

    // ---------- Tankstelle ----------
    if (MAP.gas) {
      const g = MAP.gas;
      const add = (geo, m, x, y, z, cast) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (cast) o.castShadow = true; o.receiveShadow = true; world.add(o); return o; };
      const white = lit(toon(0xf2f2f2), 0.32), red = lit(toon(0xd32b2b), 0.3), grey = toon(0x8d9299), dark = toon(0x2b2e33);
      pool(g.cx, g.cz, 19, 0xffffff, 0.32); pool(g.cx + 20, Y.z0 + 14, 9, 0xffe2b0, 0.26);
      // Dach
      add(new T.BoxGeometry(30, 0.9, 14), white, g.cx, 5.4, g.cz, true);
      add(new T.BoxGeometry(30.2, 0.35, 14.2), red, g.cx, 5.0, g.cz);
      for (const [px, pz] of [[g.cx - 13, g.cz - 5], [g.cx + 13, g.cz - 5], [g.cx - 13, g.cz + 5], [g.cx + 13, g.cz + 5]]) add(new T.BoxGeometry(0.6, 5, 0.6), grey, px, 2.5, pz, true);
      const lampM = new T.MeshBasicMaterial({ color: 0xfffbe6 });
      for (let i = 0; i < 3; i++) add(new T.BoxGeometry(2.5, 0.06, 1.2), lampM, g.cx - 9 + i * 9, 4.94, g.cz);
      // Zapfinseln + Säulen
      const pumpTex = canvasTex(128, 256, (gg, w, h) => {
        gg.fillStyle = '#e8e8e8'; gg.fillRect(0, 0, w, h); gg.fillStyle = '#d32b2b'; gg.fillRect(0, 0, w, 48);
        gg.fillStyle = '#1b1d22'; gg.fillRect(16, 70, w - 32, 50); gg.fillStyle = '#6fe36f'; gg.font = 'bold 26px monospace'; gg.textAlign = 'center'; gg.fillText('1,79', w / 2, 104);
        gg.fillStyle = '#fff'; gg.font = '900 30px Arial Black, Arial'; gg.fillText('SPRIT', w / 2, 34);
      });
      pumpTex.wrapS = pumpTex.wrapT = T.ClampToEdgeWrapping;
      const pumpFace = toon(0xffffff, { map: pumpTex });
      for (let i = 0; i < 3; i++) {
        const ix = g.cx - 9 + i * 9;
        add(new T.BoxGeometry(1.5, 0.25, 6), grey, ix, 0.125, g.cz, true);
        for (const pz of [g.cz - 1.4, g.cz + 1.4]) {
          const p = add(new T.BoxGeometry(0.9, 1.9, 0.6), [white, white, red, white, white, white], ix, 1.2, pz, true);
          for (const sdx of [-1, 1]) { const f = new T.Mesh(new T.PlaneGeometry(0.58, 1.15), pumpFace); f.position.set(ix + sdx * 0.452, 1.35, pz); f.rotation.y = sdx * Math.PI / 2; world.add(f); }
        }
      }
      // Bodenmarkierung Tankplätze
      const padM = new T.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.85 });
      for (const pz of pumps) {
        const fr = new T.Mesh(new T.RingGeometry(0, 1, 4, 1), padM);
        const w = pz.x1 - pz.x0, d = pz.z1 - pz.z0;
        const pl = new T.Mesh(new T.PlaneGeometry(w - 0.4, d - 0.4), new T.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.18 }));
        pl.rotation.x = -Math.PI / 2; pl.position.set((pz.x0 + pz.x1) / 2, 0.03, (pz.z0 + pz.z1) / 2); world.add(pl);
      }
      // Shop
      const sx = g.cx + 20, sz = Y.z0 + 6;
      add(new T.BoxGeometry(12, 4, 10), white, sx, 2, sz, true);
      add(new T.BoxGeometry(12.4, 0.5, 10.4), red, sx, 4.1, sz, true);
      const winM = toon(0x2a3a4c); winM.emissive = new T.Color(0xffd9a0); winM.emissiveIntensity = 0; nightLit.push([winM, 0.85]);
      const win = new T.Mesh(new T.PlaneGeometry(9, 2.2), winM); win.position.set(sx, 1.8, sz + 5.01); world.add(win);
      const shopSign = new T.Mesh(new T.PlaneGeometry(10, 1.4), new T.MeshBasicMaterial({ map: textTex('SHOP · 24H', 640, 96, '#d32b2b', '#ffffff', 'italic 900 64px Arial Black, Arial') }));
      shopSign.position.set(sx, 3.4, sz + 5.03); world.add(shopSign);
      // Preismast
      const pylon = add(new T.BoxGeometry(2.2, 7, 0.5), red, g.cx - 22, 3.5, Y.z1 - 2, true);
      const ps = new T.Mesh(new T.PlaneGeometry(1.9, 3), new T.MeshBasicMaterial({ map: canvasTex(128, 200, (gg, w, h) => {
        gg.fillStyle = '#1b1d22'; gg.fillRect(0, 0, w, h); gg.fillStyle = '#fff'; gg.font = '900 22px Arial Black'; gg.textAlign = 'center'; gg.fillText('SUPER', w / 2, 36);
        gg.fillStyle = '#6fe36f'; gg.font = 'bold 40px monospace'; gg.fillText('1,79', w / 2, 82); gg.fillStyle = '#fff'; gg.font = '900 22px Arial Black'; gg.fillText('DIESEL', w / 2, 128); gg.fillStyle = '#6fe36f'; gg.font = 'bold 40px monospace'; gg.fillText('1,69', w / 2, 172);
      }) }));
      ps.position.set(g.cx - 22, 4.4, Y.z1 - 1.74); world.add(ps);
    }

    // ---------- Umgebung ----------
    const distTrack = (x, z) => distFast(x, z, WALL + 40);
    let cx0 = 0, cz0 = 0; for (const p of S) { cx0 += p.x; cz0 += p.z; } cx0 /= N; cz0 /= N;
    let rad = 0; for (const p of S) rad = Math.max(rad, Math.hypot(p.x - cx0, p.z - cz0));
    // Tribüne außen an der Startgeraden
    {
      const p = S[startI], hdg = Math.atan2(-p.tz, p.tx);
      const crowd = canvasTex(512, 64, (g, w, h) => {
        g.fillStyle = '#5a6068'; g.fillRect(0, 0, w, h);
        const cs = ['#e53935', '#1e88e5', '#fdd835', '#ffffff', '#43a047', '#fb8c00', '#8e24aa', '#212121'];
        for (let i = 0; i < 700; i++) { g.fillStyle = cs[(Math.random() * cs.length) | 0]; g.beginPath(); g.arc(Math.random() * w, 8 + Math.random() * (h - 16), 3.2, 0, 7); g.fill(); }
      }, [10, 1]);
      const stand = new T.Group();
      const grey = toon(0xa7abb0), roof = toon(0xd32b2b);
      for (let r = 0; r < 6; r++) {
        const st = new T.Mesh(new T.BoxGeometry(120, 0.9, 2.2), [grey, grey, grey, grey, grey, toon(0xffffff, { map: crowd })]);
        st.position.set(0, 0.45 + r * 0.9, r * 2.2); stand.add(st);
        const base = new T.Mesh(new T.BoxGeometry(120, 0.45 + r * 0.9, 2.2), grey); base.position.set(0, (0.45 + r * 0.9) / 2, r * 2.2); stand.add(base);
      }
      const rf = new T.Mesh(new T.BoxGeometry(124, 0.4, 16), roof); rf.position.set(0, 9.5, 5); stand.add(rf);
      for (let i = -3; i <= 3; i++) { const c = new T.Mesh(new T.BoxGeometry(0.5, 9.5, 0.5), grey); c.position.set(i * 20, 4.75, 12.5); stand.add(c); }
      // Tribüne liegt rechts der Fahrtrichtung, mit Blick auf die Strecke
      const ss = MAP.standSide || 1;
      stand.position.set(p.x + p.rx * ss * (WALL + 6) + p.tx * 40, 0, p.z + p.rz * ss * (WALL + 6) + p.tz * 40);
      stand.rotation.y = hdg + (ss < 0 ? Math.PI : 0);
      world.add(stand);
    }
    // Bäume: Nadelbäume und Laubbäume gemischt, dazu Büsche
    {
      const COUNT = Math.round(700 * W);
      const flat = (c) => { const m = toon(c); m.flatShading = true; return m; };
      const trunkG = new T.CylinderGeometry(0.35, 0.5, 3, 6); trunkG.translate(0, 1.5, 0);
      const c1 = new T.ConeGeometry(3.4, 6, 7); c1.translate(0, 5.5, 0);
      const c2 = new T.ConeGeometry(2.5, 4.6, 7); c2.translate(0, 8.4, 0);
      const c3 = new T.ConeGeometry(1.5, 3.2, 7); c3.translate(0, 10.6, 0);
      const b1 = new T.IcosahedronGeometry(3.3, 1); b1.scale(1, 0.85, 1); b1.translate(0, 5.6, 0);
      const b2 = new T.IcosahedronGeometry(2.3, 1); b2.translate(1.4, 7.6, 0.6);
      const b3 = new T.IcosahedronGeometry(1.9, 0); b3.translate(-1.6, 6.9, -0.8);
      const bushG = new T.IcosahedronGeometry(1.2, 0); bushG.scale(1.3, 0.75, 1.1); bushG.translate(0, 0.7, 0);
      const mk = (g, m, n) => { const im = new T.InstancedMesh(g, m, n); im.castShadow = true; return im; };
      const trunkM = toon(0x6b4a2e);
      const con = [mk(trunkG, trunkM, COUNT), mk(c1, flat(0xffffff), COUNT), mk(c2, flat(0xffffff), COUNT), mk(c3, flat(0xffffff), COUNT)];
      const dec = [mk(trunkG, trunkM, COUNT), mk(b1, flat(0xffffff), COUNT), mk(b2, flat(0xffffff), COUNT), mk(b3, flat(0xffffff), COUNT)];
      const bush = mk(bushG, flat(0xffffff), COUNT);
      const m = new T.Matrix4(), q = new T.Quaternion(), sv = new T.Vector3(), pv = new T.Vector3(), col = new T.Color(), up = new T.Vector3(0, 1, 0);
      const greens = [0x2f7d3a, 0x3a8f41, 0x276b35, 0x4a9c3f, 0x2c6f48], leafs = [0x5aa843, 0x6db44a, 0x4a9c3f, 0x86b83e, 0x3f9247, 0xa7b83c];
      const sp = S[startI];
      let nc = 0, nd = 0, nb = 0, tries = 0;
      while (nc + nd + nb < COUNT && tries < 40000) {
        tries++;
        let x, z;
        if (terrainH) { x = cx0 + (Math.random() - 0.5) * (rad * 2 + 500); z = cz0 + (Math.random() - 0.5) * (rad * 0.9 + 600); }
        else { const a = Math.random() * Math.PI * 2, r = 30 + Math.pow(Math.random(), 0.7) * (rad + 260); x = cx0 + Math.cos(a) * r * 1.15; z = cz0 + Math.sin(a) * r; }
        if (distTrack(x, z) < WALL + 6) continue;
        if (terrainH ? (x > 30 && x < 140 && z > -80 && z < 70 && sdAll(x, z).d < 9) : sdAll(x, z).d < 9) continue;
        const ty = terrainH ? terrainH(x, z) : 0;
        if (terrainH && Math.abs(terrainH(x + 3, z) - terrainH(x - 3, z)) + Math.abs(terrainH(x, z + 3) - terrainH(x, z - 3)) > 7) continue;   // kein Baum am Fels
        // Tribüne frei lassen
        const lx = (x - sp.x) * sp.tx + (z - sp.z) * sp.tz, lz = (x - sp.x) * sp.rx + (z - sp.z) * sp.rz;
        if (lx > -30 && lx < 110 && lz * (MAP.standSide || 1) > WALL && lz * (MAP.standSide || 1) < WALL + 30) continue;
        if (cross && Math.hypot(x - cross.x, z - cross.z) < 30) continue;   // Gehsteige am Zebrastreifen frei lassen
        const s = 0.7 + Math.random() * 0.8, kind = Math.random();
        q.setFromAxisAngle(up, Math.random() * 6.28);
        m.compose(pv.set(x, ty - 0.3, z), q, sv.set(s, s * (0.85 + Math.random() * 0.4), s));
        if (kind < 0.5) {
          for (const im of con) im.setMatrixAt(nc, m);
          col.setHex(greens[(Math.random() * greens.length) | 0]);
          con[1].setColorAt(nc, col); con[2].setColorAt(nc, col.clone().offsetHSL(0, 0, 0.04)); con[3].setColorAt(nc, col.clone().offsetHSL(0, 0, 0.08)); nc++;
        } else if (kind < 0.86) {
          for (const im of dec) im.setMatrixAt(nd, m);
          col.setHex(leafs[(Math.random() * leafs.length) | 0]);
          dec[1].setColorAt(nd, col); dec[2].setColorAt(nd, col.clone().offsetHSL(0, 0, 0.05)); dec[3].setColorAt(nd, col.clone().offsetHSL(0.01, 0, -0.04)); nd++;
        } else {
          bush.setMatrixAt(nb, m); col.setHex(leafs[(Math.random() * leafs.length) | 0]).offsetHSL(0, 0, -0.05); bush.setColorAt(nb, col); nb++;
        }
      }
      for (const im of con) { im.count = nc; world.add(im); }
      for (const im of dec) { im.count = nd; world.add(im); }
      bush.count = nb; world.add(bush);
    }
    // Berge: zwei Ketten, kantig und leicht zerklüftet
    {
      const cols = [0x6f9a8a, 0x5d8a80, 0x7ea596, 0x557d78, 0x86a38f];
      const mats = cols.map(c => { const mm = toon(c); mm.flatShading = true; return mm; });
      const snow = toon(0xf4f7fa); snow.flatShading = true;
      const rough = (g, amt) => {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const hsh = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, r = hsh - Math.floor(hsh);
          const hs2 = Math.sin(x * 4.1 + z * 9.7 + y * 1.3) * 9631.7, r2 = hs2 - Math.floor(hs2);
          p.setXYZ(i, x * (1 + (r - 0.5) * amt), y * (1 + (r2 - 0.5) * amt * 0.5), z * (1 + (r2 - 0.5) * amt));
        }
        g.computeVertexNormals(); return g;
      };
      const ring = (n, R0, spread, hMin, hMax, wMin, wMax) => {
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2 + Math.random() * 0.12;
          const r = R0 + Math.random() * spread;
          const h = (hMin + Math.random() * (hMax - hMin)) * Math.sqrt(W), w = (wMin + Math.random() * (wMax - wMin)) * Math.sqrt(W);
          const mt = new T.Mesh(rough(new T.ConeGeometry(w, h, 9, 4), 0.34), mats[(i * 3 + n) % mats.length]);
          mt.position.set(cx0 + Math.cos(a) * r, h / 2 - 6, cz0 + Math.sin(a) * r); mt.rotation.y = Math.random() * 3;
          world.add(mt);
          if (h > 200 * Math.sqrt(W)) {
            const cap = new T.Mesh(rough(new T.ConeGeometry(w * 0.3, h * 0.3, 9, 2), 0.3), snow);
            cap.position.set(mt.position.x, h - 6 - h * 0.15 + 1.5, mt.position.z); cap.rotation.y = mt.rotation.y; world.add(cap);
          }
        }
      };
      ring(44, rad + 450, 320 * W, 90, 260, 120, 280);
      ring(30, rad + 900 * W, 300 * W, 240, 430, 220, 380);
    }
    // Wolken
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
        const a = Math.random() * Math.PI * 2, r = (400 + Math.random() * 700) * W;
        c.position.set(cx0 + Math.cos(a) * r, 150 + Math.random() * 120, cz0 + Math.sin(a) * r); c.rotation.y = Math.random() * 3;
        clouds.add(c);
      }
      world.add(clouds);
    }
    // Lichtmasten
    {
      const pm = toon(0x9da3aa), lm = new T.MeshBasicMaterial({ color: 0xfffbe6 });
      for (let i = 0; i < N; i += 55) {
        const p = S[i], sg = p.k > 0 ? -1 : 1;
        const x = p.x + p.rx * sg * (WALL + 2), z = p.z + p.rz * sg * (WALL + 2);
        if (sdAll(x, z).d < 2) continue;
        if (BR && (p.y > 0.05 || Math.hypot(x - BR.x, z - BR.z) < 40)) continue;   // nicht an Rampe oder Brücke
        if (MAP.mountain && i > 420 && i < N - 220) continue;                         // Bergpass: nur im Tal am Start
        const py = p.y || 0;
        const pole = new T.Mesh(new T.CylinderGeometry(0.15, 0.22, 12, 8), pm); pole.position.set(x, 6 + py, z); world.add(pole);
        const arm = new T.Mesh(new T.BoxGeometry(0.2, 0.2, 2.5), pm);
        arm.position.set(x - p.rx * sg * 1.1, 11.9 + py, z - p.rz * sg * 1.1); arm.lookAt(p.x, 11.9 + py, p.z); world.add(arm);
        const lamp = new T.Mesh(new T.BoxGeometry(0.6, 0.18, 1.0), lm);
        lamp.position.set(x - p.rx * sg * 2.2, 11.75 + py, z - p.rz * sg * 2.2); lamp.lookAt(p.x, 11.75 + py, p.z); world.add(lamp);
        flare(lamp.position.x, 11.6 + py, lamp.position.z, 7, 0xfff3d8, 0.9);
        pool(p.x + p.rx * sg * 2, p.z + p.rz * sg * 2, 19, 0xfff0d0, 0.24, py + 0.06);
      }
    }
    // Reifenstapel an Kurvenaußenseiten
    {
      const tg = new T.CylinderGeometry(0.42, 0.42, 0.28, 12), tm = toon(0x1c1d20);
      const list = [];
      for (let i = 0; i < N; i += 7) {
        const p = S[i]; if (Math.abs(p.k) < 1 / 50 || MAP.mountain) continue;
        const sg = p.k > 0 ? 1 : -1;
        const x = p.x + p.rx * sg * (WALL + 0.85), z = p.z + p.rz * sg * (WALL + 0.85);
        if (sdAll(x, z).d < 1) continue;
        list.push([x, z]);
      }
      const im = new T.InstancedMesh(tg, tm, Math.max(1, list.length * 4));
      const m = new T.Matrix4(); let n = 0;
      for (const [x, z] of list) for (let h = 0; h < 4; h++) { m.makeTranslation(x, 0.14 + h * 0.28, z); im.setMatrixAt(n++, m); }
      im.count = n; world.add(im);
    }

    // ---------- Abfragen ----------
    let lampK = -1;
    function setTime(tod) {
      const st = sky.set(tod);
      if (cloudMat) { cloudMat.color.copy(st.cloud); cloudMat.emissive.copy(st.cloud).multiplyScalar(0.5); }
      if (Math.abs(st.lamps - lampK) > 0.004) {
        lampK = st.lamps;
        for (const [mm, a] of nightLit) mm.emissiveIntensity = a * lampK;
        for (const [o, a] of nightGlow) { o.visible = lampK > 0.01; o.material.opacity = a * lampK; }
      }
      return st;
    }
    function nearest(x, z, hint) { return main.nearest(x, z, hint); }
    // Fahrbahnhöhe am Punkt (Brücke/Rampe), idx = Streckenindex des Autos (damit unten/oben eindeutig bleibt)
    function groundAt(x, z, idx) {
      if (!ELEV) return 0;
      if (idx == null || idx < 0) idx = main.nearest(x, z);
      const p = S[idx]; if (BR && p.y <= 0) return 0;
      const lat = (x - p.x) * p.rx + (z - p.z) * p.rz; if (Math.abs(lat) > WALL + 1) return 0;
      const lon = (x - p.x) * p.tx + (z - p.z) * p.tz;
      if (BR) { const q = S[(idx + (lon >= 0 ? 1 : -1) + N) % N]; return Math.max(0, p.y + (q.y - p.y) * Math.min(1, Math.abs(lon))); }
      // Bergpass: zum richtigen Streckenabschnitt weitergehen (auch ein paar Meter vor/hinter idx, z. B. an den Achsen)
      let i = idx, l = lon;
      for (let k = 0; k < 8 && (l < 0 || l >= 1); k++) {
        i = (i + (l < 0 ? -1 : 1) + N) % N;
        const a = S[i]; l = (x - a.x) * a.tx + (z - a.z) * a.tz;
      }
      const a = S[i], b = S[(i + 1) % N], f = Math.max(0, Math.min(1, l / Math.max(0.01, b.s - a.s || 1)));
      return a.y + (b.y - a.y) * f;
    }
    // Steigung in Fahrtrichtung h (positiv = bergauf)
    function gradeAt(idx, h) {
      if (!ELEV || idx == null || idx < 0) return 0;
      const p = S[idx]; return (p.gy || 0) * (Math.cos(h) * p.tx - Math.sin(h) * p.tz);
    }
    // Unterkante der Brücke über dem Punkt (für die Kamera unten durch), sonst Infinity
    function ceilAt(x, z) {
      if (!BR) return Infinity;
      let bd = 1e9, bi = -1;
      for (let k = -BR.span - 4; k <= BR.span + 4; k++) { const i = (BR.upper + k + N) % N, dx = x - S[i].x, dz = z - S[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      const p = S[bi], lat = (x - p.x) * p.rx + (z - p.z) * p.rz;
      return Math.abs(lat) < WALL + 1.5 && p.bd < BR.span + 1.5 ? p.y - BR.deck : Infinity;
    }
    // Kollision des Autos (4 Ecken + Mitte) mit dem Rand der befahrbaren Fläche
    function collide(car, halfL, halfW) {
      if (!car._hints) car._hints = areas.map(() => -1);
      const fx = Math.cos(car.h), fz = -Math.sin(car.h), rx = Math.sin(car.h), rz = Math.cos(car.h);
      let hit = 0;
      // Hauptstrecke für Punkte/Kamera
      const ri = main.sd(car.x, car.z, car.trackIdx);
      car.trackIdx = ri.i; car.lateral = ri.lat;
      for (const [a, b] of [[0, 0], [halfL, halfW], [halfL, -halfW], [-halfL, halfW], [-halfL, -halfW]]) {
        const ox = fx * a + rx * b, oz = fz * a + rz * b;
        const r = sdAll(car.x + ox, car.z + oz, car._hints);
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
    const inRect = (R, x, z) => x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1;
    // Spawnplätze in der Halle, Blick zum Tor
    const spawns = [];
    {
      const usable = [H.x0 + 4, MAP.lift.x0 - 3];
      // 20 Plätze in zwei Reihen zu je 10: vordere Reihe am Tor (Plätze 1–10), dahinter die zweite
      for (const dz of [3.6, -2.4]) {
        const row = [];
        for (let i = 0; i < 10; i++) {
          const x = usable[0] + (usable[1] - usable[0]) * i / 9;
          // jeder Platz schaut auf die Toröffnung (sonst fährt man von den äußeren Plätzen gegen die Hallenwand)
          const z = (H.z0 + H.z1) / 2 + dz, tx = Math.max(dcx - doorW + 3, Math.min(dcx + doorW - 3, x)), tz = H.z1 + 1.5;
          row.push({ x, z, h: Math.atan2(-(tz - z), tx - x) });
        }
        row.sort((a, b) => Math.abs(a.x - dcx) - Math.abs(b.x - dcx));   // Platz 1 direkt vor dem Tor
        spawns.push(...row);
      }
    }
    const sp = S[startI - 12];
    return {
      id: MAP.id, name: MAP.name, fuel: !!MAP.fuel && !!MAP.gas,
      S, N, len: path.len, sun: sunL, sunDir, sky, setTime, world, clouds, nearest, collide,
      start: { x: sp.x, z: sp.z, h: Math.atan2(-sp.tz, sp.tx) },
      startI,                                   // Index der Start-/Ziellinie (für die Challenge-Runde)
      crossing: cross ? { x: cross.x, z: cross.z, tx: cross.tx, tz: cross.tz, rx: cross.rx, rz: cross.rz, half: CROSS_HALF } : null,
      spawns, ROAD, WALL, groundAt, gradeAt, ceilAt, bridge: BR, terrainH,
      sd: (x, z) => sdAll(x, z).d,
      onLift: (x, z) => inRect(MAP.lift, x, z),
      liftCenter: { x: (MAP.lift.x0 + MAP.lift.x1) / 2, z: (MAP.lift.z0 + MAP.lift.z1) / 2 },
      setLift: (y, state) => { if (liftCtl) liftCtl(y, state); },
      // Kamera in der Halle halten (sonst landet sie hinter der Wand)
      clampCam(cx, cz, carX, carZ) {
        if (!inRect({ x0: H.x0 - 1, x1: H.x1 + 1, z0: H.z0 - 1, z1: H.z1 + 3 }, carX, carZ)) return null;
        return { x: Math.max(H.x0 + 0.6, Math.min(H.x1 - 0.6, cx)), z: Math.max(H.z0 + 0.6, Math.min(H.z1 + 12, cz)) };
      },
      atPump: (x, z) => pumps.some(p => inRect(p, x, z)),
      inPaddock: (x, z) => hall.sd(x, z).d < 0 || yard.sd(x, z).d < 0 || door.sd(x, z).d < 0 || (pit.sd(x, z).d < 0 && main.sd(x, z).d > 0),
      mini: { S, pit: pitPath.S, hall: H, yard: Y, gas: MAP.gas, lift: MAP.lift },
      dispose() {
        scene.remove(world);
        world.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) { if (mm.map) mm.map.dispose(); mm.dispose(); } } });
      }
    };
  }

  window.Track = { build, MAPS, ORDER: ['hakone', 'bridge', 'big', 'mountain', 'straight'], _buildPath: buildPath };
})();
