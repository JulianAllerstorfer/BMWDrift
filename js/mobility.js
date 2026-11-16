/* =====================================================================
   Elektro-Rennrollstuhl und Elektro-Rollator – eigene Fahrzeuge
   Koordinaten wie bei den Autos: +X vorne, +Y oben, +Z rechts,
   Ursprung Mitte Radstand am Boden. Hinterräder treiben an.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;

  // Rohr zwischen zwei Punkten
  function tube(a, b, r) {
    const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const g = new T.CylinderGeometry(r, r, len, 10);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return g;
  }
  const box = (sx, sy, sz, x, y, z) => { const g = new T.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; };

  // Speichenrad: Reifen, Felge, Speichen, Nabe; optional Greifreifen (Rollstuhl)
  function spokeWheel(R, W, mats, opt) {
    const g = new T.Group();
    const tire = new T.Mesh(new T.TorusGeometry(R - W * 0.5, W * 0.5, 10, 40), mats.rubber); g.add(tire);
    const rim = new T.Mesh(new T.TorusGeometry(R - W * 1.05, W * 0.28, 6, 40), mats.rim); g.add(rim);
    const n = opt.spokes || 12;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, s = i % 2 ? 1 : -1;
      const sp = new T.Mesh(tube([0, 0, s * W * 0.25], [Math.cos(a) * (R - W * 1.1), Math.sin(a) * (R - W * 1.1), 0], opt.spokeR || 0.003), mats.chrome);
      g.add(sp);
    }
    const hub = new T.Mesh(new T.CylinderGeometry(R * 0.1, R * 0.1, W * 0.9, 14).rotateX(Math.PI / 2), mats.steel); g.add(hub);
    if (opt.push) {   // Greifreifen außen
      const pr = new T.Mesh(new T.TorusGeometry(R * 0.86, 0.008, 6, 40), mats.chrome); pr.position.z = W * 0.9; g.add(pr);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(new T.Mesh(tube([Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, W * 0.9], [Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, W * 0.2], 0.005), mats.chrome)); }
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  // Lenkrolle (kleines Vollrad)
  function caster(R, W, mats) {
    const g = new T.Group();
    g.add(new T.Mesh(new T.CylinderGeometry(R, R, W, 20).rotateX(Math.PI / 2), mats.rubber));
    g.add(new T.Mesh(new T.CylinderGeometry(R * 0.55, R * 0.55, W + 0.004, 16).rotateX(Math.PI / 2), mats.rim));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }


  // ---------- Jonny (Fahrer von Jonny's Rollstuhl) ----------
  // Gesicht als Textur auf der Kopfkugel: Blick Richtung +x (= Mitte der Textur, u = 0,5)
  function jonnyFaceTexture() {
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), cx = W / 2;
    g.fillStyle = '#ecc6a8'; g.fillRect(0, 0, W, H);
    // leichte Rötung auf den Wangen, Bartschatten am Kinn
    for (const sd of [-1, 1]) { const gr = g.createRadialGradient(cx + sd * 40, 150, 2, cx + sd * 40, 150, 22); gr.addColorStop(0, 'rgba(225,140,120,0.35)'); gr.addColorStop(1, 'rgba(225,140,120,0)'); g.fillStyle = gr; g.fillRect(cx + sd * 40 - 24, 126, 48, 48); }
    g.fillStyle = 'rgba(120,90,70,0.12)'; g.beginPath(); g.ellipse(cx, 178, 34, 14, 0, 0, 7); g.fill();
    // Augenbrauen: dunkelbraun, kräftig, fast gerade
    g.strokeStyle = '#3a2618'; g.lineWidth = 5; g.lineCap = 'round';
    for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(cx + sd * 13, 101); g.quadraticCurveTo(cx + sd * 26, 96, cx + sd * 40, 101); g.stroke(); }
    // Augen: weiß, brauner Iris, dunkle Pupille, Oberlid-Linie
    for (const sd of [-1, 1]) {
      const ex = cx + sd * 27, ey = 115;
      g.fillStyle = '#fbf6f0'; g.beginPath(); g.ellipse(ex, ey, 9, 5, 0, 0, 7); g.fill();
      g.fillStyle = '#5a3a22'; g.beginPath(); g.arc(ex, ey, 4.6, 0, 7); g.fill();
      g.fillStyle = '#1b120c'; g.beginPath(); g.arc(ex, ey, 2.2, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + 1.5, ey - 1.5, 1, 0, 7); g.fill();
      g.strokeStyle = '#2a1a10'; g.lineWidth = 2; g.beginPath(); g.ellipse(ex, ey, 9.5, 5.5, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    }
    // Nase (Schatten), Mund: leichtes, geschlossenes Lächeln
    g.strokeStyle = 'rgba(150,100,80,0.55)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 3, 116); g.quadraticCurveTo(cx - 6, 136, cx - 7, 141); g.quadraticCurveTo(cx, 146, cx + 7, 141); g.stroke();
    g.fillStyle = '#c97b74'; g.beginPath(); g.moveTo(cx - 19, 160); g.quadraticCurveTo(cx, 156, cx + 19, 160); g.quadraticCurveTo(cx, 170, cx - 19, 160); g.fill();
    g.strokeStyle = '#8e4a45'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 20, 160); g.quadraticCurveTo(cx, 164, cx + 20, 159); g.stroke();
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  // „Lolas“-Logo: rosa Schreibschrift, gelbes Cocktailglas mit Limette
  function lolasTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 200; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 200);
    g.font = 'italic bold 66px "Brush Script MT", "Snell Roundhand", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = '#a77ab5'; g.strokeText('Lolas', 128, 52); g.fillStyle = '#f1d3ef'; g.fillText('Lolas', 128, 52);
    g.fillStyle = '#f2d64b'; g.beginPath(); g.moveTo(92, 92); g.lineTo(164, 92); g.lineTo(134, 140); g.lineTo(122, 140); g.closePath(); g.fill();
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(125, 140, 6, 36); g.beginPath(); g.ellipse(128, 180, 20, 6, 0, 0, 7); g.fill();
    g.fillStyle = '#7ccf4a'; g.beginPath(); g.arc(164, 88, 15, 0, 7); g.fill(); g.strokeStyle = '#e8f7d8'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.moveTo(164, 88); g.lineTo(164 + Math.cos(a) * 13, 88 + Math.sin(a) * 13); g.stroke(); }
    g.fillStyle = '#ffffff'; for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(128 + sd * 42, 118, 9, 6, 0, 0, 7); g.fill(); }
    const t = new T.CanvasTexture(c); return t;
  }
  // Foto-Kopf: img/jonny.jpg (Kopf mit Haaren, 560×680) vorn auf die Kopfkugel projiziert, Rest Haar-/Hautfarbe
  const JONNY_HAIR = '#4b3627', JONNY_SKIN = '#e9c3a6';
  // Kontur von Haaren + Gesicht im Foto (Pixel) – außerhalb wird Haar- bzw. Hautfarbe ergänzt
  const JONNY_OUTLINE = [[20, 250], [40, 120], [110, 30], [230, 0], [380, 5], [470, 60], [520, 150], [545, 215], [480, 250], [470, 300], [478, 380], [455, 420], [440, 500],
    [400, 580], [330, 640], [280, 655], [220, 640], [150, 580], [120, 500], [95, 420], [80, 380], [85, 300], [80, 262], [40, 262]];
  function jonnyPhotoTexture() {
    const W = 560, H = 680, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const fill = () => { g.fillStyle = JONNY_HAIR; g.fillRect(0, 0, W, 370); g.fillStyle = JONNY_SKIN; g.fillRect(0, 370, W, H - 370); };
    fill();
    const t = new T.CanvasTexture(c); t.anisotropy = 4;
    if (typeof Image === 'undefined') return t;   // (Tests ohne Browser)
    const img = new Image();
    img.onload = () => {
      g.save(); g.beginPath(); JONNY_OUTLINE.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.clip();
      g.drawImage(img, 0, 0, W, H); g.restore();
      t.needsUpdate = true;
    };
    img.src = 'img/jonny.jpg';
    return t;
  }
  function jonnyPhotoHead(add, mats, hc) {
    const SX = 0.95, SY = 1.08, SZ = 0.9, R = 0.1, hh = R * SY, hw = R * SZ;
    // Kopfform: nach unten zum Kinn hin schmaler (wie die Kontur im Foto)
    const shape = (geo) => {
      geo.scale(SX, SY, SZ);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = y < 0 ? 1 - 0.32 * Math.pow(-y / hh, 1.3) : 1; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
      p.needsUpdate = true; geo.computeVertexNormals(); return geo;
    };
    // vordere Hälfte (Blick +x) mit Foto, Planar-Projektion von vorn (nach der Formgebung -> Gesicht unverzerrt)
    const front = shape(new T.SphereGeometry(R, 40, 28, Math.PI / 2, Math.PI));
    const pa = front.attributes.position, uv = front.attributes.uv;
    for (let i = 0; i < pa.count; i++) uv.setXY(i, 0.5 - pa.getZ(i) / (2 * hw), 0.5 + pa.getY(i) / (2 * hh));
    uv.needsUpdate = true;
    add(front.translate(hc[0], hc[1], hc[2]), new T.MeshStandardMaterial({ map: jonnyPhotoTexture(), roughness: 0.8, metalness: 0 }));
    // hintere Hälfte: oben Haare, unten Haut (Nacken)
    const hair = E46.mat.real(new T.Color(JONNY_HAIR).getHex(), 0.85, 0), skin = E46.mat.real(new T.Color(JONNY_SKIN).getHex(), 0.75, 0);
    add(shape(new T.SphereGeometry(R, 24, 12, -Math.PI / 2, Math.PI, 0, Math.PI * 0.6)).translate(hc[0], hc[1], hc[2]), hair);
    add(shape(new T.SphereGeometry(R, 24, 8, -Math.PI / 2, Math.PI, Math.PI * 0.6, Math.PI * 0.4)).translate(hc[0], hc[1], hc[2]), skin);
  }
  // Kopf mit Gesicht, Ohren und wuscheligen braunen Haaren mit langem Pony (Kopfmitte bei hc, Radius 0.1)
  function jonnyHead(add, mats, hc) {
    const R = 0.1, skinTex = new T.MeshStandardMaterial({ map: jonnyFaceTexture(), roughness: 0.75, metalness: 0 });
    add(new T.SphereGeometry(R, 32, 20).scale(0.95, 1.08, 0.9).translate(hc[0], hc[1], hc[2]), skinTex);
    for (const sd of [-1, 1]) add(new T.SphereGeometry(0.022, 8, 6).scale(0.6, 1.2, 1).translate(hc[0] - 0.005, hc[1] - 0.005, hc[2] + sd * 0.092), mats.skin);
    const hair = E46.mat.real(0x4a3120, 0.85, 0), hair2 = E46.mat.real(0x5d3f29, 0.85, 0);
    // Haarkappe: Oberkopf, Hinterkopf, Seiten (etwas voluminöser als der Kopf)
    add(new T.SphereGeometry(R * 1.13, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.34).scale(1.02, 1.08, 1.0).translate(hc[0] - 0.008, hc[1] + 0.012, hc[2]), hair);   // Oberkopf bis Haaransatz
    add(new T.SphereGeometry(R * 1.08, 24, 10, -Math.PI * 0.6, Math.PI * 1.2, Math.PI * 0.25, Math.PI * 0.33).translate(hc[0] - 0.006, hc[1] - 0.005, hc[2]), hair);   // Hinterkopf tiefer
    // wuschelige Strähnen rundherum, langer Pony vorn bis zu den Augenbrauen
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;                   // Winkel um den Kopf (0 = vorn, +x)
      const front = Math.cos(a) > 0.55;
      const len = front ? 0.055 + rnd() * 0.02 : 0.05 + rnd() * 0.03;   // Pony endet über den Augenbrauen
      const tuft = new T.ConeGeometry(0.019 + rnd() * 0.008, len, 5);
      const m = add(tuft, rnd() < 0.5 ? hair : hair2);
      const rr = R * (front ? 1.0 : 1.1), yy = front ? 0.072 : 0.02 + rnd() * 0.04;
      m.position.set(hc[0] + Math.cos(a) * rr, hc[1] + yy, hc[2] + Math.sin(a) * rr);
      // Spitze nach unten und leicht nach außen (Pony fällt nach vorn über die Stirn)
      const out = new T.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = new T.Vector3(0, -1, 0).addScaledVector(out, front ? 0.45 : 0.35 + rnd() * 0.3).add(new T.Vector3((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4)).normalize();
      m.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), dir);
    }
    // ein paar Strähnen oben (zerzaust)
    for (let i = 0; i < 14; i++) {
      const m = add(new T.ConeGeometry(0.02, 0.05, 5), i % 2 ? hair : hair2), a = rnd() * Math.PI * 2, r = rnd() * 0.06;
      m.position.set(hc[0] + Math.cos(a) * r - 0.01, hc[1] + R * 1.12 + 0.005, hc[2] + Math.sin(a) * r);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3((rnd() - 0.5) * 1.4, 1, (rnd() - 0.5) * 1.4).normalize());
    }
  }

  // Fahrer/in mit Rennhelm. pose: 'sit' (Rollstuhl) oder 'stand' (Rollator); opt.jonny: Jonny ohne Helm, mit Frisur und Lolas-Shirt
  function rider(mats, pose, opt) {
    opt = opt || {};
    const g = new T.Group(), add = (geo, m) => { const o = new T.Mesh(geo, m); o.castShadow = true; g.add(o); return o; };
    if (pose === 'ride') {
      // auf der Sitzbank, Füße auf den Rasten, Hände am Lenker
      for (const s of [-1, 1]) {
        add(tube([-0.32, 0.9, s * 0.12], [0.02, 0.84, s * 0.16], 0.06), mats.pants);     // Oberschenkel
        add(tube([0.02, 0.84, s * 0.16], [-0.04, 0.36, s * 0.17], 0.05), mats.pants);    // Unterschenkel
        add(box(0.2, 0.07, 0.09, 0.0, 0.33, s * 0.17), mats.shoe);
        add(tube([-0.3, 1.38, s * 0.19], [0.1, 1.12, s * 0.27], 0.042), mats.shirt);     // Oberarm
        add(tube([0.1, 1.12, s * 0.27], [0.36, 1.06, s * 0.33], 0.038), mats.shirt);     // Unterarm zum Griff
      }
      add(box(0.3, 0.16, 0.34, -0.36, 0.96, 0), mats.pants);                              // Becken
      const torso = add(new T.BoxGeometry(0.24, 0.5, 0.36), mats.shirt); torso.position.set(-0.3, 1.26, 0); torso.rotation.z = -0.3;   // leicht nach vorn gebeugt
      add(new T.SphereGeometry(0.1, 14, 10).translate(-0.16, 1.58, 0), mats.skin);
      add(new T.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(-0.17, 1.6, 0), mats.helmet);
      add(box(0.02, 0.07, 0.17, -0.05, 1.58, 0), mats.visor);
    } else if (pose === 'sit') {
      add(box(0.36, 0.13, 0.36, 0.0, 0.55, 0), mats.pants);                       // Oberschenkel
      for (const s of [-1, 1]) add(tube([0.17, 0.52, s * 0.1], [0.27, 0.16, s * 0.1], 0.055), mats.pants);   // Unterschenkel
      for (const s of [-1, 1]) add(box(0.14, 0.06, 0.09, 0.31, 0.12, s * 0.1), mats.shoe);
      add(box(0.22, 0.48, 0.36, -0.12, 0.86, 0), mats.shirt); // Oberkörper
      for (const s of (opt.noArms ? [] : [-1, 1])) {   // Arme zum Greifreifen (Jonny: kurze Ärmel, Unterarm Haut)
        const A = [-0.1, 1.04, s * 0.2], B = [0.05, 0.72, s * 0.3];
        if (opt.jonny) {
          const M = [A[0] + (B[0] - A[0]) * 0.32, A[1] + (B[1] - A[1]) * 0.32, A[2] + (B[2] - A[2]) * 0.32];
          const grp = new T.Group(); g.add(grp);
          const sl = new T.Mesh(tube(A, M, 0.048), mats.shirt), fa = new T.Mesh(tube(M, B, 0.036), mats.skin); sl.castShadow = fa.castShadow = true; grp.add(sl, fa);
          if (s < 0) g.userData.armL = grp;
        } else { const a = add(tube(A, B, 0.042), mats.shirt); if (s < 0) g.userData.armL = a; }
      }
      if (opt.jonny) {
        jonnyPhotoHead(add, mats, [-0.1, 1.2, 0]);
        add(tube([-0.1, 1.07, 0], [-0.1, 1.12, 0], 0.04), mats.skin);   // Hals
        const logo = new T.Mesh(new T.PlaneGeometry(0.085, 0.066), new T.MeshBasicMaterial({ map: lolasTexture(), transparent: true }));
        logo.rotation.y = Math.PI / 2; logo.position.set(-0.007, 0.97, -0.085); g.add(logo);   // linke Brust (vom Fahrer aus)
      } else {
        add(new T.SphereGeometry(0.1, 14, 10).translate(-0.1, 1.2, 0), mats.skin);
        add(new T.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(-0.11, 1.22, 0), mats.helmet);
        add(box(0.02, 0.06, 0.16, 0.0, 1.21, 0), mats.visor);
      }
    } else {
      for (const s of [-1, 1]) {
        add(tube([-0.12, 0.13, s * 0.11], [-0.04, 0.5, s * 0.1], 0.055), mats.pants);   // Unterschenkel
        add(tube([-0.04, 0.5, s * 0.1], [-0.12, 0.9, s * 0.1], 0.065), mats.pants);     // Oberschenkel (leicht in der Hocke)
        add(box(0.2, 0.06, 0.09, -0.08, 0.1, s * 0.11), mats.shoe);
      }
      add(box(0.26, 0.5, 0.36, -0.02, 1.12, 0), mats.shirt);
      for (const s of [-1, 1]) add(tube([0.02, 1.3, s * 0.2], [0.2, 0.92, s * 0.25], 0.042), mats.shirt);   // Arme zu den Griffen
      add(new T.SphereGeometry(0.1, 14, 10).translate(0.06, 1.48, 0), mats.skin);
      add(new T.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0.05, 1.5, 0), mats.helmet);
      add(box(0.02, 0.06, 0.16, 0.16, 1.49, 0), mats.visor);
      g.rotation.z = -0.12;   // nach vorn gelehnt
    }
    return g;
  }

  // Raucher-Arm mit Marlboro: S0 Schulter, P_OUT/P_MOUTH Ellbogen+Hand je Pose, mouth = Mundposition, hide = normaler Arm
  function smokeKit(parent, mats, S0, P_OUT, P_MOUTH, mouth, hide) {
    const arm = new T.Group(); arm.visible = false; parent.add(arm);
    const limb = (r) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, 1, 8), mats.shirt); arm.add(m); return m; };
    const upper = limb(0.04), fore = limb(0.036), hand = new T.Group(); arm.add(hand);
    if (mats.foreArm) fore.material = mats.foreArm;
    hand.add(new T.Mesh(new T.SphereGeometry(0.045, 10, 8), mats.skin));
    const cig = new T.Group(); cig.position.y = 0.02; cig.scale.setScalar(1.6); cig.visible = false; hand.add(cig);
    const cf = new T.Mesh(new T.CylinderGeometry(0.0048, 0.0048, 0.024, 8).rotateZ(Math.PI / 2), E46.mat.real(0xc98a3c, 0.7, 0)); cf.position.x = 0.012; cig.add(cf);
    const cp = new T.Mesh(new T.CylinderGeometry(0.0046, 0.0046, 0.06, 8).rotateZ(Math.PI / 2), E46.mat.real(0xf4f2ec, 0.8, 0)); cp.position.x = 0.054; cig.add(cp);
    const tipMat = new T.MeshBasicMaterial({ color: 0xff5a14 }), tip = new T.Mesh(new T.CylinderGeometry(0.0047, 0.0047, 0.007, 8).rotateZ(Math.PI / 2), tipMat); tip.position.x = 0.087; cig.add(tip);
    const setLimb = (m, a, b) => { const d = b.clone().sub(a), L = d.length(); m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); };
    const pose = (k) => {
      const e = P_OUT.e.clone().lerp(P_MOUTH.e, k), h = P_OUT.h.clone().lerp(P_MOUTH.h, k);
      setLimb(upper, S0, e); setLimb(fore, e, h); hand.position.copy(h); hand.rotation.set(0, 0.4 * (1 - k), 0.3 * (1 - k));
    };
    pose(0);
    return {
      mouth,
      setCig(on, glow) { cig.visible = !!on; tipMat.color.setHex(glow ? 0xffa040 : 0xc23a0c); },
      setSmokeArm(on, k) { arm.visible = !!on; if (hide) hide.visible = !on; if (on) pose(Math.max(0, Math.min(1, k || 0))); },
      cigTipWorld(v) { return tip.getWorldPosition(v || new T.Vector3()); }
    };
  }
  function baseMats(cfg) {
    const M = E46.mat, real = M.real;
    return {
      paint: M.carPaint(cfg.paint != null ? cfg.paint : 0x2a6bd8, { roughness: 0.35, metalness: 0.4 }),
      dark: real(0x1b1c1f, 0.6, 0.2), steel: real(0x5a5e63, 0.4, 0.8), chrome: real(0xd8dce0, 0.12, 1),
      rubber: real(0x161616, 0.85, 0, { envMapIntensity: 0.4 }), rim: real(cfg.rimColor != null ? cfg.rimColor : 0xaab2bc, 0.25, 0.8),
      seat: real(0x202124, 0.8, 0),
      led: new T.MeshBasicMaterial({ color: 0x33c6ff }), tail: new T.MeshBasicMaterial({ color: 0xa50e17 }), light: new T.MeshBasicMaterial({ color: 0xfff6dc }),
      skin: real(0xe2b08a, 0.7, 0), shirt: real(0x1f2d4a, 0.8, 0), pants: real(0x2a2b30, 0.85, 0), shoe: real(0xeeeeee, 0.6, 0),
      helmet: E46.mat.carPaint(0xe8e8ea, { roughness: 0.25 }), visor: real(0x101418, 0.05, 0.6)
    };
  }

  // gemeinsamer Rahmen der API
  function api(o) {
    const { root, chassis, wheels, exhaust, mats, spec, dims, rF, rR, extra } = o;
    return Object.assign({
      root, chassis, wheels, exhaust, model: spec.id, spec, diesel: false, electric: true,
      lights: { tail: mats.tail, tailInner: mats.tail },
      setPaint(hex) { mats.paint.color.setHex(hex); },
      setRimStyle() {}, setRimColor(hex) { mats.rim.color.setHex(hex); }, setWheelOpts() {}, setStance() {}, setLook() {},
      setBrake(on) { mats.tail.color.setHex(on ? 0xff2633 : 0xa50e17); },
      update(st) {
        for (const w of wheels) {
          w.spinAngle = (w.spinAngle || 0) + (w.front ? st.frontSpin * rR / rF : st.rearSpin);
          w.spin.rotation.z = -w.spinAngle;
          w.pivot.rotation.y = w.front ? st.steer * (w.steerMul || 1) : 0;
        }
        chassis.rotation.order = 'XZY';
        chassis.rotation.x = (st.roll || 0) * 0.6;
        chassis.rotation.z = (st.pitch || 0) * 0.5;
        if (o.anim) o.anim(st);
      },
      dispose() { root.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); },
      dims
    }, extra || {});
  }
  function addWheel(chassis, wheels, w, x, y, z, front, camber) {
    const pivot = new T.Group(); pivot.position.set(x, y, z); chassis.add(pivot);
    const tilt = new T.Group(); tilt.rotation.x = camber || 0; pivot.add(tilt);
    const spin = new T.Group(); tilt.add(spin);
    const flip = new T.Group(); flip.rotation.y = z > 0 ? 0 : Math.PI; spin.add(flip); flip.add(w);
    wheels.push({ pivot, spin, side: Math.sign(z), front });
  }

  // Kackhaufen-Tarnung: Braun-Tarnflecken mit kleinen Kackhaufen drin (einmal erzeugt, für alle Rollstühle)
  let camoTex = null;
  function getCamoTex() {
    if (camoTex) return camoTex;
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#7a5230'; g.fillRect(0, 0, 512, 512);
    const browns = ['#5a3a1c', '#8f6236', '#3f2712', '#a5773f', '#6b4524', '#4d3016'];
    // Tarnflecken (auch über den Rand gespiegelt, damit die Textur nahtlos kachelt)
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, rx = 25 + Math.random() * 60, ry = 14 + Math.random() * 34, a = Math.random() * Math.PI;
      g.fillStyle = browns[i % browns.length];
      for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(x + ox + rx * 0.6, y + oy + ry * 0.4, rx * 0.55, ry * 0.7, a + 0.8, 0, Math.PI * 2); g.fill();
      }
    }
    // Kackhaufen: drei gestapelte Wülste, Spitze, Glanzlicht
    function pile(x, y, s) {
      const layers = [[0, 0, 1], [0.04, -0.62, 0.74], [-0.02, -1.12, 0.48]];
      for (const [dx, dy, w] of layers) {
        g.fillStyle = '#3b210c'; g.beginPath(); g.ellipse(x + dx * s, y + dy * s + 2, w * s, 0.36 * s, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#5c3414'; g.beginPath(); g.ellipse(x + dx * s, y + dy * s, w * s, 0.34 * s, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,220,170,0.35)'; g.beginPath(); g.ellipse(x + dx * s - w * s * 0.35, y + dy * s - 0.12 * s, w * s * 0.28, 0.08 * s, -0.2, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#5c3414'; g.beginPath(); g.moveTo(x - 0.22 * s, y - 1.25 * s); g.quadraticCurveTo(x + 0.05 * s, y - 1.75 * s, x + 0.3 * s, y - 1.62 * s); g.quadraticCurveTo(x + 0.12 * s, y - 1.4 * s, x + 0.2 * s, y - 1.2 * s); g.fill();
    }
    for (let i = 0; i < 14; i++) pile(30 + (i % 4) * 128 + (Math.random() - 0.5) * 40 + (((i / 4) | 0) % 2) * 60, 70 + ((i / 4) | 0) * 128 + (Math.random() - 0.5) * 30, 20 + Math.random() * 14);
    pile(256, 300, 70);   // ein großer in der Mitte (gut sichtbar auf den Radabdeckungen)
    camoTex = new T.CanvasTexture(c); camoTex.wrapS = camoTex.wrapT = T.RepeatWrapping; camoTex.anisotropy = 4;
    return camoTex;
  }

  // ------------------------------------------------------------ Rollstuhl
  function wheelchair(cfg) {
    const SP = window.CAR_MODELS.wheelchair, mats = baseMats(cfg);
    const root = new T.Group(), chassis = new T.Group(); root.add(chassis);
    const body = new T.Group(); chassis.add(body);
    const add = (g, m) => { const o = new T.Mesh(g, m); o.castShadow = true; body.add(o); return o; };
    const RR = 0.3, AXR = -0.34, AXF = 0.40, RF = 0.075, TR = 0.33;
    // Rahmen (Lackfarbe)
    for (const s of [-1, 1]) {
      const z = s * 0.22;
      add(tube([AXR + 0.02, 0.5, z], [0.3, 0.5, z], 0.016), mats.paint);           // Sitzrohr
      add(tube([0.3, 0.5, z], [0.42, 0.14, z * 0.8], 0.016), mats.paint);           // zum Fußbrett
      add(tube([AXR + 0.02, 0.5, z], [AXR - 0.06, 0.92, z], 0.016), mats.paint);   // Rückenrohr
      add(tube([AXR, 0.3, z], [AXF, 0.18, z * 0.9], 0.014), mats.paint);           // unteres Rohr
      add(tube([AXF, 0.18, z * 0.9], [AXF, RF + 0.03, z * 0.9], 0.012), mats.steel); // Gabel
      add(tube([AXR - 0.06, 0.92, z], [AXR - 0.16, 0.95, z], 0.013), mats.dark);   // Schiebegriff
      add(tube([AXR - 0.05, 0.22, z], [AXR - 0.28, 0.08, z], 0.012), mats.steel);  // Kippschutz
      const kw = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.025, 12).rotateX(Math.PI / 2), mats.rubber); kw.position.set(AXR - 0.29, 0.05, z); body.add(kw);
    }
    add(tube([AXR, 0.3, -0.22], [AXR, 0.3, 0.22], 0.016), mats.paint);              // Achsrohr
    const foot = add(box(0.12, 0.012, 0.36, 0.43, 0.13, 0), mats.dark);              // Fußbrett
    const cushion = add(box(0.42, 0.05, 0.44, -0.07, 0.52, 0), mats.seat);            // Sitzkissen
    const backrest = add(box(0.04, 0.38, 0.42, AXR - 0.05, 0.74, 0), mats.seat);      // Rückenlehne
    const frameParts = []; body.traverse(o => { if (o.isMesh && o.material === mats.paint) frameParts.push(o); });
    // Antrieb: Jonnys Arme (kein Motor mehr)
    // Licht vorn, Rücklicht hinten
    const hl = new T.Mesh(new T.CircleGeometry(0.03, 16), mats.light); hl.rotation.y = Math.PI / 2; hl.position.set(0.48, 0.15, 0); body.add(hl); const heads = [hl];
    for (const s of [-1, 1]) { const tl = new T.Mesh(new T.PlaneGeometry(0.04, 0.02), mats.tail); tl.rotation.y = -Math.PI / 2; tl.position.set(AXR - 0.17, 0.95, s * 0.22); body.add(tl); }
    mats.shirt.color.setHex(0x5b5658); mats.skin.color.setHex(0xecc6a8); mats.foreArm = mats.skin;   // dunkelgraues T-Shirt, helle Haut
    const rd = rider(mats, 'sit', { jonny: true, noArms: true }); rd.position.set(0.0, 0.0, 0); body.add(rd);
    // Arme treiben die Greifreifen an: Hand greift hinten oben, schiebt nach vorn, holt in der Luft zurück
    const PR = RR * 0.86, CAMB = 0.14, UA = 0.31, FA = 0.30;
    const unit = (r, m) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, 1, 10), m); o.castShadow = true; return o; };
    const setLimb = (m, a, b) => { const d = b.clone().sub(a), L = d.length(); m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); };
    const rimPt = (s, deg, out, lift) => {   // Punkt am Greifreifen (Winkel ab vorn, gegen den Uhrzeiger), out = weiter vom Reifen weg
      const a = deg * Math.PI / 180, r = PR + (lift || 0);
      return new T.Vector3(r * Math.cos(a), r * Math.sin(a), s * (0.028 * 0.9 + 0.03 + (out || 0))).applyAxisAngle(new T.Vector3(1, 0, 0), -s * CAMB).add(new T.Vector3(AXR, RR, s * TR));
    };
    const arms = [-1, 1].map(s => {
      const grp = new T.Group(); rd.add(grp);
      const up = unit(0.034, mats.skin), sl = unit(0.05, mats.shirt), fo = unit(0.031, mats.skin);
      const hand = new T.Mesh(new T.SphereGeometry(0.042, 10, 8), mats.skin); hand.scale.set(1.25, 0.8, 0.9); hand.castShadow = true;
      grp.add(up, sl, fo, hand);
      return { s, grp, up, sl, fo, hand, S: new T.Vector3(-0.1, 1.04, s * 0.2) };
    });
    rd.userData.armL = arms[0].grp;
    const E = new T.Vector3(), H = new T.Vector3(), U = new T.Vector3(), P = new T.Vector3(), M = new T.Vector3();
    const ease = (t) => t * t * (3 - 2 * t);
    function poseArm(a, h) {
      U.copy(h).sub(a.S); const d = Math.min(UA + FA - 0.005, Math.max(0.12, U.length())); U.normalize();
      H.copy(a.S).addScaledVector(U, d);
      const x = (UA * UA - FA * FA + d * d) / (2 * d), y = Math.sqrt(Math.max(0, UA * UA - x * x));
      P.set(-1, -0.15, a.s * 0.7); P.addScaledVector(U, -P.dot(U)).normalize();   // Ellbogen nach hinten/außen
      E.copy(a.S).addScaledVector(U, x).addScaledVector(P, y);
      setLimb(a.up, a.S, E); M.copy(a.S).lerp(E, 0.45); setLimb(a.sl, a.S, M); setLimb(a.fo, E, H); a.hand.position.copy(H);
    }
    let ph = 0, act = 0, lastT = 0, dk = 0;
    const rest = (s) => rimPt(s, 82, 0.01);
    const SEAT = new T.Vector3(-0.05, 0.55, 0), Q = new T.Quaternion(), INV = new T.Matrix4();
    // Sturz: Jonny fliegt nach vorn raus, landet auf dem Rücken (Beine in der Luft) und muss wieder einsteigen
    // st: 'seat' → 'fly' (0,8 s) → 'down' → 'climb' (1,6 s) → 'seat'
    const fall = { st: 'seat', t: 0, yaw: 0, L: new T.Vector3(), Q: new T.Quaternion() };
    const QI = new T.Quaternion(), QZ = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2), QY = new T.Quaternion();
    const FLY = 0.8, CLIMB = 1.6, HV = new T.Vector3();
    function fallOut() {
      if (fall.st !== 'seat') return;
      fall.st = 'fly'; fall.t = 0; fall.yaw = (Math.random() - 0.5) * 0.9;
      QY.setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI + fall.yaw); fall.Q.copy(QY).multiply(QZ);
      fall.L.set(0.6 * Math.cos(fall.yaw), 0.25, -0.6 * Math.sin(fall.yaw));
    }
    function climbIn() { if (fall.st === 'down') { fall.st = 'climb'; fall.t = 0; } }
    function seatNow() { fall.st = 'seat'; fall.t = 0; }
    function poseFall(dt) {
      fall.t += dt;
      let e, arc, flail;
      if (fall.st === 'fly') {
        const k = Math.min(1, fall.t / FLY); e = 1 - Math.pow(1 - k, 2); arc = 0.75 * 4 * k * (1 - k); flail = 1;
        if (k >= 1) { fall.st = 'down'; fall.t = 0; }
      } else if (fall.st === 'down') {
        e = 1; arc = fall.t < 0.35 ? 0.07 * Math.sin(Math.PI * fall.t / 0.35) : 0; flail = 0.35;   // kleiner Hüpfer beim Aufprall, dann zappeln
      } else {
        const k = Math.min(1, fall.t / CLIMB); e = 1 - ease(k); arc = 0.3 * Math.sin(Math.PI * k); flail = 0.6 * (1 - k);
        if (k >= 1) { fall.st = 'seat'; fall.t = 0; }
      }
      rd.quaternion.copy(QI).slerp(fall.Q, e);
      rd.position.copy(fall.L).multiplyScalar(e); rd.position.y += arc;
      rd.updateMatrix(); INV.copy(rd.matrix).invert();
      const w = performance.now() / 1000 * (fall.st === 'fly' ? 22 : 9);
      for (const a of arms) {   // Arme rudern (Körperkoordinaten, nicht mehr am Greifreifen)
        HV.set(0.12 + 0.1 * Math.sin(w + a.s), 0.22 + 0.14 * Math.sin(w * 1.3 + a.s * 2) * flail, a.s * (0.2 + 0.12 * flail));
        poseArm(a, HV.add(a.S));
      }
    }
    const anim = (st) => {
      const now = performance.now() / 1000, dt = Math.min(0.1, lastT ? now - lastT : 0); lastT = now;
      if (fall.st !== 'seat') { poseFall(st.dt != null ? Math.min(0.1, st.dt) : dt); return; }
      const th = st.throttle || 0, v = Math.abs(st.speed || 0);
      // Drift: Oberkörper lehnt in die Kurve (Innenseite = -sign(beta)), innere Hand bremst am Greifreifen
      const bt = v > 4 ? (st.beta || 0) : 0;
      dk += (Math.max(-1, Math.min(1, -bt / 0.55)) - dk) * Math.min(1, dt * 5);
      const lean = dk * 0.15;
      rd.rotation.set(lean, 0, -Math.abs(dk) * 0.08);   // seitlich + etwas nach vorn
      Q.setFromEuler(rd.rotation); rd.position.copy(SEAT).sub(SEAT.clone().applyQuaternion(Q));
      rd.updateMatrix(); INV.copy(rd.matrix).invert();
      act += ((th > 0.05 ? 1 : 0) - act) * Math.min(1, dt * 6);
      ph = (ph + dt * (0.85 + 1.0 * th + Math.min(0.6, v * 0.02)) * (act > 0.02 ? 1 : 0)) % 1;
      for (const a of arms) {
        let h;
        if (ph < 0.55) h = rimPt(a.s, 108 - 64 * ease(ph / 0.55), 0.008);                  // schieben, Hand am Reifen
        else { const q = (ph - 0.55) / 0.45, k = Math.sin(Math.PI * q); h = rimPt(a.s, 44 + 64 * ease(q), 0.01 + 0.05 * k, 0.07 * k); }   // zurückholen
        h.lerp(rest(a.s), 1 - act);
        const ki = Math.max(0, dk * a.s);   // innere Hand: greift oben hinten und bremst
        if (ki > 0.01) h.lerp(rimPt(a.s, 100, 0.006), ki);
        poseArm(a, h.applyMatrix4(INV));
      }
    };
    anim({ throttle: 0, speed: 0, beta: 0 });
    // Raucher: Arm links seitlich raus, zum Ziehen an den Mund (Kopf bei x -0.1, y 1.2)
    const smoker = smokeKit(rd, mats, new T.Vector3(-0.1, 1.04, -0.2),
      { e: new T.Vector3(-0.02, 0.9, -0.4), h: new T.Vector3(0.16, 0.99, -0.5) },
      { e: new T.Vector3(0.06, 0.93, -0.24), h: new T.Vector3(0.03, 1.15, -0.07) },
      new T.Vector3(0.0, 1.17, 0), rd.userData.armL);
    // Räder: große Antriebsräder mit Sturz (oben nach innen), kleine Lenkrollen
    const wheels = [], discs = [];
    for (const s of [-1, 1]) {
      const rw = spokeWheel(RR, 0.028, mats, { spokes: 16, push: true });
      // Radabdeckungen (nur mit Tarnung sichtbar), beidseitig über den Speichen
      for (const dz of [-1, 1]) { const d = new T.Mesh(new T.CircleGeometry(RR - 0.028 * 1.3, 40), mats.dark); d.position.z = dz * 0.028 * 0.4; d.visible = false; rw.add(d); discs.push(d); }
      addWheel(chassis, wheels, rw, AXR, RR, s * TR, false, -s * CAMB);
      addWheel(chassis, wheels, caster(RF, 0.035, mats), AXF, RF, s * 0.2, true);
    }
    // Kackhaufen-Tarnung an/aus: Rahmen, Sitz, Lehne, Fußbrett und Radabdeckungen bekommen das Muster
    let camoMat = null, camoOn = false;
    function setCamo(on) {
      on = !!on; if (on === camoOn) return; camoOn = on;
      if (on && !camoMat) camoMat = E46.mat.real(0xffffff, 0.6, 0.05, { map: getCamoTex() });
      for (const m of frameParts) m.material = on ? camoMat : mats.paint;
      cushion.material = backrest.material = on ? camoMat : mats.seat;
      foot.material = on ? camoMat : mats.dark;
      for (const d of discs) { d.material = camoMat; d.visible = on; d.castShadow = on; }
    }
    return api({ root, chassis, wheels, exhaust: [new T.Vector3(AXR - 0.1, 0.35, 0)], mats, spec: SP, rF: RF, rR: RR, anim,
      dims: { XF: 0.5, XR: -0.65, AXF, AXR, WHEEL_R: RR, halfW: 0.4, trackHalf: TR },
      extra: Object.assign({ cam: { d: 0.66, h: 0.8, look: 0.8 }, hoodCam: new T.Vector3(0.0, 1.22, 0), collide: [0.6, 0.42], smokeScale: 0.4, skidW: 0.04, headlights: heads, glareSize: 0.35, noWindow: true,
        setLook(look) { setCamo(look && look.camo); }, setCamo,
        fallOut, climbIn, seatNow, fallState: () => fall.st }, smoker) });
  }

  // ------------------------------------------------------------ Rollator
  function rollator(cfg) {
    const SP = window.CAR_MODELS.rollator, mats = baseMats(cfg);
    const root = new T.Group(), chassis = new T.Group(); root.add(chassis);
    const body = new T.Group(); chassis.add(body);
    const add = (g, m) => { const o = new T.Mesh(g, m); o.castShadow = true; body.add(o); return o; };
    const R = 0.11, AXF = 0.28, AXR = -0.26, TH = 0.27;
    for (const s of [-1, 1]) {
      const z = s * 0.26;
      add(tube([AXF, R + 0.02, z], [0.0, 0.9, z * 0.95], 0.014), mats.paint);       // Vorderbein -> Griffrohr
      add(tube([AXR, R + 0.02, z], [-0.02, 0.62, z * 0.97], 0.014), mats.paint);    // Hinterbein
      add(tube([0.0, 0.9, z * 0.95], [-0.14, 0.95, z * 0.95], 0.014), mats.paint);  // Griff-Bogen
      add(tube([-0.14, 0.95, z * 0.95], [-0.26, 0.95, z * 0.95], 0.018), mats.dark); // Handgriff
      add(tube([-0.1, 0.96, z * 0.95], [-0.2, 0.92, z * 0.95], 0.006), mats.steel); // Bremshebel
      add(tube([AXR, R + 0.02, z], [AXF, R + 0.02, z], 0.01), mats.paint);          // unteres Seitenrohr
    }
    add(tube([0.02, 0.6, -0.25], [0.02, 0.6, 0.25], 0.012), mats.paint);              // Querstrebe
    add(box(0.3, 0.025, 0.42, -0.02, 0.6, 0), mats.seat);                             // Sitzfläche
    add(box(0.04, 0.12, 0.44, -0.16, 0.74, 0), mats.seat);                            // Rückengurt
    // Korb vorne (Drahtgitter angedeutet)
    const bx = 0.14, by = 0.42, bw = 0.34;
    for (let i = 0; i <= 4; i++) add(tube([bx - 0.1 + i * 0.05, by - 0.12, -bw / 2], [bx - 0.1 + i * 0.05, by - 0.12, bw / 2], 0.004), mats.chrome);
    for (const s of [-1, 1]) for (let i = 0; i <= 3; i++) add(tube([bx - 0.1, by - 0.12 + i * 0.04, s * bw / 2], [bx + 0.1, by - 0.12 + i * 0.04, s * bw / 2], 0.004), mats.chrome);
    for (let i = 0; i <= 3; i++) add(tube([bx + 0.1, by - 0.12 + i * 0.04, -bw / 2], [bx + 0.1, by - 0.12 + i * 0.04, bw / 2], 0.004), mats.chrome);
    // Trittbrett hinten mit E-Motor und Akku, blaue LEDs
    add(box(0.42, 0.03, 0.4, AXR - 0.12, 0.13, 0), mats.dark);
    add(box(0.32, 0.007, 0.36, AXR - 0.12, 0.148, 0), real0());
    add(box(0.26, 0.1, 0.22, 0.02, 0.2, 0), mats.dark);
    add(box(0.26, 0.01, 0.01, 0.02, 0.2, 0.112), mats.led); add(box(0.26, 0.01, 0.01, 0.02, 0.2, -0.112), mats.led);
    const hl = new T.Mesh(new T.CircleGeometry(0.03, 16), mats.light); hl.rotation.y = Math.PI / 2; hl.position.set(0.25, 0.34, 0); body.add(hl); const heads = [hl];
    for (const s of [-1, 1]) { const tl = new T.Mesh(new T.PlaneGeometry(0.04, 0.025), mats.tail); tl.rotation.y = -Math.PI / 2; tl.position.set(AXR - 0.335, 0.13, s * 0.15); body.add(tl); }
    const rd = rider(mats, 'stand'); rd.position.set(AXR - 0.12, 0.15, 0); body.add(rd);
    const wheels = [];
    for (const s of [-1, 1]) {
      addWheel(chassis, wheels, caster(R, 0.04, mats), AXF, R, s * TH, true);
      addWheel(chassis, wheels, caster(R, 0.04, mats), AXR, R, s * TH, false);
    }
    return api({ root, chassis, wheels, exhaust: [new T.Vector3(AXR - 0.3, 0.2, 0)], mats, spec: SP, rF: R, rR: R,
      dims: { XF: 0.4, XR: -0.6, AXF, AXR, WHEEL_R: R, halfW: 0.35, trackHalf: TH },
      extra: { cam: { d: 0.66, h: 0.85, look: 0.9 }, hoodCam: new T.Vector3(-0.3, 1.6, 0), collide: [0.55, 0.38], smokeScale: 0.4, skidW: 0.05, headlights: heads, glareSize: 0.35 } });
  }

  // ------------------------------------------------------------ Moped 50 ccm
  function moped(cfg) {
    const SP = window.CAR_MODELS.moped, mats = baseMats(cfg);
    const root = new T.Group(), chassis = new T.Group(); root.add(chassis);
    const lean = new T.Group(); chassis.add(lean);            // Schräglage: alles kippt um die Aufstandslinie
    const body = new T.Group(); lean.add(body);
    const add = (g, m, par) => { const o = new T.Mesh(g, m); o.castShadow = true; (par || body).add(o); return o; };
    const R = 0.29, AXF = 0.62, AXR = -0.58, HEAD = [0.4, 0.92];   // Räder, Lenkkopf (x, y)
    mats.alu = E46.mat.real(0x9aa0a6, 0.45, 0.7);
    // Rahmen: Rückgrat vom Lenkkopf zum Motor, dann zur Hinterradschwinge
    add(tube([HEAD[0], HEAD[1], 0], [0.05, 0.42, 0], 0.03), mats.paint);
    add(tube([HEAD[0] - 0.02, HEAD[1] - 0.05, 0], [-0.25, 0.72, 0], 0.026), mats.paint);
    add(tube([-0.25, 0.72, 0], [-0.62, 0.74, 0], 0.022), mats.paint);
    for (const s of [-1, 1]) {
      add(tube([0.0, 0.36, s * 0.07], [AXR, R, s * 0.07], 0.02), mats.paint);                 // Schwinge
      add(tube([AXR + 0.05, R + 0.03, s * 0.08], [-0.42, 0.74, s * 0.08], 0.022), mats.chrome);   // Federbein
      add(new T.CylinderGeometry(0.032, 0.032, 0.18, 10).applyMatrix4(new T.Matrix4().makeRotationZ(0.5)).translate(-0.48, 0.58, s * 0.08), mats.dark);
    }
    // Tank (Lackfarbe) mit Zierstreifen, Sitzbank, Seitendeckel, Heckbürzel
    const tank = add(new T.SphereGeometry(0.17, 18, 12).scale(1.35, 0.62, 0.7).translate(0.16, 0.86, 0), mats.paint);
    add(new T.SphereGeometry(0.03, 10, 8).scale(1, 0.6, 1).translate(0.2, 0.96, 0), mats.chrome);          // Tankdeckel
    for (const s of [-1, 1]) add(box(0.22, 0.025, 0.004, 0.16, 0.86, s * 0.12), mats.chrome);
    add(box(0.5, 0.075, 0.24, -0.27, 0.8, 0), mats.seat);
    add(box(0.46, 0.035, 0.22, -0.27, 0.855, 0), mats.seat);
    for (const s of [-1, 1]) add(box(0.26, 0.16, 0.02, -0.25, 0.64, s * 0.1), mats.paint);
    add(box(0.22, 0.08, 0.2, -0.6, 0.8, 0), mats.paint);
    // Gepäckträger
    for (const s of [-1, 1]) add(tube([-0.5, 0.86, s * 0.1], [-0.78, 0.86, s * 0.1], 0.008), mats.chrome);
    for (let i = 0; i < 3; i++) add(tube([-0.56 - i * 0.1, 0.86, -0.1], [-0.56 - i * 0.1, 0.86, 0.1], 0.007), mats.chrome);
    // Hinterer Kotflügel, Rücklicht, Kennzeichen
    add(new T.TorusGeometry(R + 0.04, 0.05, 6, 20, Math.PI * 0.55).scale(1, 1, 0.8).rotateZ(Math.PI * 0.32).translate(AXR, R, 0), mats.chrome);
    const tl = add(new T.BoxGeometry(0.03, 0.05, 0.1), mats.tail); tl.position.set(-0.8, 0.8, 0);
    // Moped-Kennzeichen (klein, rot-weiß-roter Streifen oben) – kann von der Polizei abgenommen werden
    const plateTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d');
      g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 160); g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 152);
      g.fillStyle = '#d0141e'; g.fillRect(8, 8, 240, 12); g.fillRect(8, 32, 240, 12);
      g.fillStyle = '#111'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const t = String(cfg.plate || 'GM 50 AB').replace(/[·]/g, ' ').slice(0, 9); g.fillText(t, 128, 102, 236);
      return new T.CanvasTexture(c);
    })();
    const plate = new T.Group(); plate.position.set(-0.83, 0.7, 0); body.add(plate);
    add(new T.BoxGeometry(0.006, 0.1, 0.16), mats.dark, plate);
    const plateFace = new T.Mesh(new T.PlaneGeometry(0.155, 0.095), new T.MeshBasicMaterial({ map: plateTex })); plateFace.rotation.y = -Math.PI / 2; plateFace.position.x = -0.004; plate.add(plateFace);
    // Motor: Gehäuse, schräg stehender Zylinder mit Kühlrippen, Vergaser, Kettenschutz
    add(box(0.3, 0.2, 0.2, -0.02, 0.33, 0), mats.alu);
    add(new T.CylinderGeometry(0.1, 0.1, 0.22, 16).rotateX(Math.PI / 2).translate(-0.06, 0.32, 0.03), mats.alu);
    const cylG = new T.Group(); cylG.position.set(0.1, 0.42, 0); cylG.rotation.z = -0.9; body.add(cylG);
    add(new T.CylinderGeometry(0.055, 0.055, 0.2, 14), mats.dark, cylG);
    for (let i = 0; i < 6; i++) add(new T.BoxGeometry(0.15, 0.008, 0.15).translate(0, -0.07 + i * 0.03, 0), mats.alu, cylG);
    add(new T.CylinderGeometry(0.02, 0.02, 0.05, 8).translate(0, 0.13, 0), mats.chrome, cylG);   // Zündkerze
    add(new T.CylinderGeometry(0.04, 0.035, 0.08, 12).rotateZ(Math.PI / 2).translate(-0.16, 0.46, -0.04), mats.dark);  // Vergaser/Luftfilter
    add(box(0.55, 0.05, 0.03, -0.3, 0.32, -0.1), mats.dark);
    // Pedale (Mofa-Kurbel) und Fußrasten
    for (const s of [-1, 1]) {
      add(tube([-0.02, 0.3, s * 0.12], [-0.02, 0.33, s * 0.24], 0.012), mats.steel);
      add(box(0.11, 0.025, 0.06, -0.02, 0.33, s * 0.27), mats.rubber);
    }
    // Resonanzauspuff (Zweitakt-Birne) rechts unten, Endrohr hinten
    const exP = [[0.14, 0.42, 0.05], [0.16, 0.22, 0.13], [0.0, 0.17, 0.17], [-0.25, 0.22, 0.17], [-0.48, 0.34, 0.16], [-0.66, 0.42, 0.15]];
    const curve = new T.CatmullRomCurve3(exP.map(p => new T.Vector3(...p)));
    const exGeo = new T.TubeGeometry(curve, 30, 0.03, 10, false), pa = exGeo.attributes.position, tmp = new T.Vector3();
    // Birne aufblasen: dick in der Mitte, dünn am Krümmer und am Endrohr
    for (let i = 0; i < pa.count; i++) {
      tmp.fromBufferAttribute(pa, i);
      let best = 0, bd = 1e9; for (let k = 0; k <= 40; k++) { const d = curve.getPoint(k / 40).distanceToSquared(tmp); if (d < bd) { bd = d; best = k / 40; } }
      const c = curve.getPoint(best), sc = 1 + 1.4 * Math.pow(Math.sin(Math.min(1, Math.max(0, (best - 0.2) / 0.62)) * Math.PI), 1.2);
      tmp.sub(c).multiplyScalar(sc).add(c); pa.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    exGeo.computeVertexNormals();
    add(exGeo, mats.steel);
    add(new T.CylinderGeometry(0.018, 0.018, 0.12, 10).rotateZ(Math.PI / 2 + 0.3).translate(-0.72, 0.44, 0.15), mats.chrome);
    // Fahrer/in
    const rd = rider(mats, 'ride'); body.add(rd);
    // Räder (einspurig) – Vorderrad trägt Gabel, Lenker, Scheinwerfer und lenkt mit
    const wheels = [];
    addWheel(lean, wheels, spokeWheel(R, 0.06, mats, { spokes: 28, spokeR: 0.0025 }), AXR, R, 0, false);
    addWheel(lean, wheels, spokeWheel(R, 0.055, mats, { spokes: 28, spokeR: 0.0025 }), AXF, R, 0, true);
    for (const w of wheels) {   // Trommelbremse
      w.spin.add(new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.09, 16).rotateX(Math.PI / 2), mats.alu));
    }
    const fw = wheels[1]; fw.steerMul = 0.55;
    const steer = new T.Group(); fw.pivot.add(steer);
    const hx = HEAD[0] - AXF, hy = HEAD[1] - R;        // Lenkkopf relativ zur Vorderachse
    for (const s of [-1, 1]) {
      add(tube([0, 0, s * 0.065], [hx, hy, s * 0.065], 0.022), mats.chrome, steer);                  // Gabel
      add(tube([hx * 0.55, hy * 0.55, s * 0.065], [hx, hy, s * 0.065], 0.028), mats.paint, steer);   // Gabelholme
    }
    add(new T.TorusGeometry(R + 0.035, 0.035, 6, 16, Math.PI * 0.5).scale(1, 1, 0.75).rotateZ(Math.PI * 0.2), mats.chrome, steer);  // Kotflügel vorn
    add(tube([hx - 0.02, hy + 0.08, 0], [hx, hy - 0.02, 0], 0.02), mats.steel, steer);
    for (const s of [-1, 1]) {
      add(tube([hx - 0.02, hy + 0.08, 0], [hx - 0.05, hy + 0.16, s * 0.3], 0.013), mats.chrome, steer);   // Lenkerhälfte
      add(tube([hx - 0.05, hy + 0.16, s * 0.3], [hx - 0.06, hy + 0.16, s * 0.37], 0.019), mats.dark, steer);   // Griff
      add(tube([hx - 0.03, hy + 0.15, s * 0.25], [hx + 0.06, hy + 0.13, s * 0.31], 0.006), mats.steel, steer); // Hebel
      add(new T.SphereGeometry(0.02, 8, 6).translate(hx - 0.04, hy + 0.2, s * 0.22), mats.chrome, steer);     // Spiegel
      add(tube([hx - 0.04, hy + 0.1, s * 0.2], [hx - 0.04, hy + 0.2, s * 0.22], 0.004), mats.chrome, steer);
    }
    // Rundscheinwerfer mit Chromring, Tacho
    add(new T.CylinderGeometry(0.075, 0.065, 0.1, 18).rotateZ(Math.PI / 2).translate(hx + 0.05, hy - 0.02, 0), mats.chrome, steer);
    const hl = add(new T.CircleGeometry(0.066, 18), mats.light, steer); hl.rotation.y = Math.PI / 2; hl.position.set(hx + 0.101, hy - 0.02, 0); const heads = [hl];
    add(new T.CylinderGeometry(0.04, 0.04, 0.03, 14).translate(hx - 0.03, hy + 0.12, 0), mats.dark, steer);

    let leanS = 0;
    return api({ root, chassis, wheels, exhaust: [new T.Vector3(-0.78, 0.45, 0.15)], mats, spec: SP, rF: R, rR: R,
      dims: { XF: 0.95, XR: -0.86, AXF, AXR, WHEEL_R: R, halfW: 0.38, trackHalf: 0.02 },
      extra: {
        twoStroke: cfg.badge !== '4T', headlights: heads, glareSize: 0.55, hasPlate: () => plate.visible, setPlateOff(off) { plate.visible = !off; }, cam: { d: 0.72, h: 0.85, look: 0.95 }, hoodCam: new T.Vector3(-0.1, 1.58, 0), collide: [0.92, 0.36], smokeScale: 0.4, skidW: 0.07,
        update(st) {
          for (const w of wheels) {
            w.spinAngle = (w.spinAngle || 0) + (w.front ? st.frontSpin : st.rearSpin);
            w.spin.rotation.z = -w.spinAngle;
            w.pivot.rotation.y = w.front ? st.steer * w.steerMul : 0;
          }
          // Schräglage aus der Querbeschleunigung (Karosserie-Rollen des Autos umgedreht und verstärkt)
          const target = Math.max(-0.8, Math.min(0.8, -(st.roll || 0) * 8.5));
          leanS += (target - leanS) * 0.25;
          lean.rotation.x = leanS;
          chassis.rotation.order = 'XZY';
          chassis.rotation.z = (st.pitch || 0) * 0.8;
        }
      } });
  }

  // ------------------------------------------------------------ Zipfer Märzen (fahrende Bierflasche)
  // Nachbau nach Produktfoto: braune Longneck-Flasche, hochkantes Hauptetikett (Creme, Goldrahmen, Wappen,
  // großes blaues „Zipfer“, „MÄRZEN“, blaues Band „SEIT 1858“, goldener Fuß), Halsetikett, Kronkorken.
  // Etiketten wie auf der echten Flasche: oben = Richtung Hals, Schrift läuft rund um die Flasche.
  const NAVY = '#1b2a5c', GOLD = '#c9a24a', GOLD2 = '#e8cf86', CREAM = '#f7f4ea';
  function crest(g, cx, cy, s) {   // Wappen: Krone, blaues Schild mit „Zipfer“, goldene Löwen links/rechts
    g.save(); g.translate(cx, cy); g.scale(s, s);
    g.fillStyle = GOLD;
    for (const sd of [-1, 1]) {   // Löwen (vereinfacht: Körper, Kopf, Mähne, Schweif)
      g.beginPath(); g.ellipse(sd * 62, 10, 20, 34, sd * 0.25, 0, 7); g.fill();
      g.beginPath(); g.arc(sd * 58, -30, 15, 0, 7); g.fill();
      g.beginPath(); g.ellipse(sd * 66, -24, 12, 18, 0, 0, 7); g.fill();
      g.lineWidth = 5; g.strokeStyle = GOLD; g.beginPath(); g.moveTo(sd * 72, 38); g.quadraticCurveTo(sd * 96, 30, sd * 88, 4); g.stroke();
      g.fillRect(sd * 62 - 4 + (sd < 0 ? -10 : 2), 38, 14, 14);
    }
    g.beginPath(); g.moveTo(-40, -30); g.lineTo(40, -30); g.lineTo(40, 20); g.quadraticCurveTo(40, 52, 0, 64); g.quadraticCurveTo(-40, 52, -40, 20); g.closePath();
    g.fillStyle = GOLD; g.fill();
    g.beginPath(); g.moveTo(-34, -24); g.lineTo(34, -24); g.lineTo(34, 18); g.quadraticCurveTo(34, 46, 0, 57); g.quadraticCurveTo(-34, 46, -34, 18); g.closePath();
    g.fillStyle = NAVY; g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 22px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Zipfer', 0, 12);
    g.fillStyle = GOLD; g.beginPath(); g.moveTo(-30, -34); g.lineTo(-30, -52); g.lineTo(-18, -42); g.lineTo(0, -60); g.lineTo(18, -42); g.lineTo(30, -52); g.lineTo(30, -34); g.closePath(); g.fill();
    g.restore();
  }
  function labelTexture() {
    const W = 800, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = GOLD; g.fillRect(0, 0, W, H);
    g.fillStyle = CREAM; g.fillRect(16, 16, W - 32, H - 32);
    g.strokeStyle = NAVY; g.lineWidth = 4; g.strokeRect(30, 30, W - 60, H - 60);
    g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80);
    // oben: goldenes Band
    g.fillStyle = GOLD2; g.fillRect(150, 62, W - 300, 46); g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(150, 62, W - 300, 46);
    g.fillStyle = NAVY; g.font = 'bold 22px Georgia, serif'; g.fillText('ÖSTERREICHISCHE BRAUTRADITION', W / 2, 86, W - 330);
    crest(g, W / 2, 190, 1.05);
    g.fillStyle = GOLD; g.font = 'bold 22px Georgia, serif'; g.fillText('1858', W / 2 - 250, 300); g.fillText('2008', W / 2 + 250, 300);
    // großes „Zipfer“
    g.fillStyle = NAVY; g.font = '900 210px "Arial Black", "Helvetica Neue", Arial, sans-serif'; g.fillText('Zipfer', W / 2, 420, W - 110);
    g.fillStyle = GOLD; g.font = 'bold 20px Arial'; g.fillText('MARKE', W / 2 + 270, 500);
    // MÄRZEN
    g.fillStyle = NAVY; g.font = 'bold 104px Georgia, "Times New Roman", serif'; g.fillText('MÄRZEN', W / 2, 575, W - 160);
    g.fillStyle = GOLD; g.fillRect(170, 640, W - 340, 4);
    g.fillStyle = NAVY; g.font = 'bold 36px Georgia, serif'; g.fillText('GEBRAUT MIT', W / 2, 690); g.fillText('NATURHOPFEN', W / 2, 735);
    // blaues Band „SEIT 1858“ mit Punkten
    g.fillStyle = NAVY; g.fillRect(44, 785, W - 88, 58);
    g.fillStyle = '#ffffff'; g.font = 'bold 34px Georgia, serif'; g.fillText('•  SEIT 1858  •', W / 2, 815);
    for (let x = 70; x < W - 60; x += 22) { if (Math.abs(x - W / 2) < 150) continue; g.beginPath(); g.arc(x, 815, 4, 0, 7); g.fill(); }
    // goldener Fuß
    g.fillStyle = GOLD2; g.fillRect(44, 850, W - 88, H - 894);
    g.fillStyle = NAVY; g.font = 'italic 44px "Brush Script MT", "Snell Roundhand", Georgia, serif'; g.fillText('Premium-Qualität', W / 2, 905);
    g.font = 'bold 26px Georgia, serif'; g.fillText('EIN GLAS HELLER FREUDE', W / 2, 955);
    const t = new T.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function neckTexture() {
    const W = 512, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = GOLD; g.fillRect(0, 0, W, H);
    g.fillStyle = CREAM; g.fillRect(12, 12, W - 24, H - 24);
    g.strokeStyle = NAVY; g.lineWidth = 3; g.strokeRect(24, 24, W - 48, H - 48);
    crest(g, W / 2, 150, 1.3);
    g.fillStyle = NAVY; g.fillRect(24, 300, W - 48, 6); g.fillRect(24, 420, W - 48, 6);
    g.font = 'bold 92px Georgia, "Times New Roman", serif'; g.fillText('MÄRZEN', W / 2, 365, W - 70);
    g.fillStyle = GOLD2; g.fillRect(24, 470, W - 48, 70);
    g.fillStyle = '#c4161c'; g.font = 'bold 40px Georgia, serif'; g.fillText('SEIT 1858', W / 2, 507);
    const t = new T.CanvasTexture(c); t.anisotropy = 8; return t;
  }
  function zipfer(cfg) {
    const SP = window.CAR_MODELS.zipfer, mats = baseMats(cfg), real = E46.mat.real;
    const root = new T.Group(), chassis = new T.Group(); root.add(chassis);
    const body = new T.Group(); chassis.add(body);
    const add = (g, m, par) => { const o = new T.Mesh(g, m); o.castShadow = true; (par || body).add(o); return o; };
    // Maße nach Foto (Verhältnisse zur Gesamthöhe): Bauchradius 0,1235, gerader Bauch bis 0,576, Hals ab 0,80 (Radius 0,061)
    const L = 3.5, RB = 0.1235 * L, X0 = -L / 2, YC = 0.78;
    const R = 0.3, AXF = 1.05, AXR = -1.05, TR = 0.68;
    mats.glass = real(0x5e2f0b, 0.05, 0.1, { envMapIntensity: 1.7 });     // braunes Flaschenglas
    mats.gold = real(0xd2b45c, 0.25, 1);
    mats.cap = real(0xd9d6cc, 0.22, 1);
    // Profil (Radius in RB, Höhe in L) – glatt interpoliert, damit Etiketten der Form folgen
    const PROF = [[0, 0], [0.92, 0], [0.99, 0.012], [1, 0.03], [1, 0.576], [0.975, 0.615], [0.9, 0.66], [0.76, 0.705], [0.62, 0.745], [0.53, 0.778], [0.49, 0.8],
      [0.465, 0.83], [0.45, 0.87], [0.445, 0.91], [0.45, 0.935], [0.5, 0.944], [0.505, 0.958], [0.47, 0.966], [0, 0.966]];
    const rAt = (h) => {   // Radius (m) bei Höhe h (Anteil von L), nur im Außenprofil
      for (let i = 1; i < PROF.length; i++) if (PROF[i][1] >= h && PROF[i - 1][1] <= h && PROF[i][1] > PROF[i - 1][1]) {
        const a = PROF[i - 1], b = PROF[i], f = (h - a[1]) / (b[1] - a[1]); return (a[0] + (b[0] - a[0]) * f) * RB;
      }
      return RB;
    };
    const lathe = (pts, seg, ps, pl) => new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 48, ps || 0, pl || Math.PI * 2).rotateZ(-Math.PI / 2).translate(X0, YC, 0);
    const outer = []; for (let i = 0; i < PROF.length; i++) outer.push([PROF[i][0] * RB, PROF[i][1] * L]);
    const glass = add(lathe(outer, 64), mats.glass);
    // Etikett-Fläche: Teil-Drehkörper zwischen h0 und h1 (folgt Schulter und Hals)
    const band = (h0, h1, ps, pl, n) => { const p = []; for (let i = 0; i <= n; i++) { const h = h0 + (h1 - h0) * i / n; p.push([rAt(h) + 0.005, h * L]); } return lathe(p, 32, ps, pl); };
    const labTex = labelTexture(), neckTex = neckTexture();
    // Hauptetikett 0,14–0,553 der Höhe, ca. 150° breit; Nackenetikett 0,72–0,93, ca. 170°; je eins pro Seite
    const LAB_W = 2.62, NECK_W = 2.95;
    for (const th of [0, Math.PI]) {
      add(band(0.14, 0.553, th - LAB_W / 2, LAB_W, 6), new T.MeshStandardMaterial({ map: labTex, roughness: 0.55, metalness: 0 }));
      add(band(0.72, 0.928, th - NECK_W / 2, NECK_W, 16), new T.MeshStandardMaterial({ map: neckTex, roughness: 0.5, metalness: 0 }));
    }
    // Kronkorken (silbern) mit 21 Zacken
    const cap = new T.Group(); cap.position.set(X0 + 0.966 * L, YC, 0); body.add(cap);
    add(new T.CylinderGeometry(0.53 * RB, 0.55 * RB, 0.075, 21).rotateZ(-Math.PI / 2).translate(0.03, 0, 0), mats.cap, cap);
    for (let i = 0; i < 21; i++) { const a = i / 21 * Math.PI * 2; add(new T.BoxGeometry(0.06, 0.022, 0.026).translate(0.012, Math.cos(a) * 0.55 * RB, Math.sin(a) * 0.55 * RB), mats.cap, cap); }
    const capTop = add(new T.CircleGeometry(0.5 * RB, 28), new T.MeshStandardMaterial({ map: (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#e6e2d6'; g.beginPath(); g.arc(128, 128, 128, 0, 7); g.fill(); crest(g, 128, 120, 0.95);
      g.fillStyle = NAVY; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText('Zipfer', 128, 222); return new T.CanvasTexture(c);
    })(), roughness: 0.3, metalness: 0.6 }), cap);
    capTop.rotation.y = Math.PI / 2; capTop.position.x = 0.068;
    // Fahrgestell: dunkle Wanne, Halteschellen um die Flasche, Lichter, Auspuff
    const heads = [];
    add(box(2.95, 0.1, 1.08, -0.2, 0.3, 0), mats.dark);
    for (const x of [X0 + 0.07 * L, X0 + 0.567 * L]) add(new T.TorusGeometry(RB + 0.02, 0.025, 6, 32, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2).translate(x, YC, 0), mats.chrome);
    for (const x of [X0 + 0.07 * L, X0 + 0.567 * L]) for (const s of [-1, 1]) add(box(0.06, YC - 0.3, 0.05, x, (YC + 0.3) / 2, s * (RB + 0.02)), mats.chrome);
    for (const s of [-1, 1]) {
      const hl = add(new T.CircleGeometry(0.075, 18), mats.light); hl.rotation.y = Math.PI / 2; hl.position.set(1.276, 0.32, s * 0.4); heads.push(hl);
      add(new T.CylinderGeometry(0.085, 0.085, 0.05, 18).rotateZ(Math.PI / 2).translate(1.25, 0.32, s * 0.4), mats.chrome);
      const tl = add(new T.PlaneGeometry(0.22, 0.07), mats.tail); tl.rotation.y = -Math.PI / 2; tl.position.set(-1.676, 0.3, s * 0.38);
      add(new T.CylinderGeometry(0.045, 0.045, 0.2, 14).rotateZ(Math.PI / 2).translate(-1.7, 0.22, s * 0.22), mats.chrome);
      add(box(0.12, 0.06, 0.3, AXF, 0.3, s * 0.52), mats.steel); add(box(0.12, 0.06, 0.3, AXR, 0.3, s * 0.52), mats.steel);   // Radträger
    }
    const wheels = [];
    for (const s of [-1, 1]) {
      addWheel(chassis, wheels, caster(R, 0.24, mats), AXF, R, s * TR, true);
      addWheel(chassis, wheels, caster(R, 0.26, mats), AXR, R, s * TR, false);
    }
    return api({ root, chassis, wheels, exhaust: [new T.Vector3(-1.8, 0.22, 0.22), new T.Vector3(-1.8, 0.22, -0.22)], mats, spec: SP, rF: R, rR: R,
      dims: { XF: 1.75, XR: -1.75, AXF, AXR, WHEEL_R: R, halfW: 0.8, trackHalf: TR },
      extra: { electric: false, setPaint() {}, foamAt: new T.Vector3(X0 + 0.966 * L + 0.09, YC, 0), headlights: heads, glareSize: 0.7, cam: { d: 0.85, h: 0.95, look: 1 }, hoodCam: new T.Vector3(0.1, YC + RB + 0.35, 0),
        collide: [1.78, 0.8], smokeScale: 0.85, skidW: 0.22 } });
  }
  // rutschfester Belag auf dem Trittbrett
  function real0() { return E46.mat.real(0x2e3034, 0.95, 0); }

  const orig = E46.create;
  E46.create = function (cfg) {
    if (cfg && cfg.model === 'wheelchair') return wheelchair(cfg);
    if (cfg && cfg.model === 'rollator') return rollator(cfg);
    if (cfg && cfg.model === 'moped') return moped(cfg);
    if (cfg && cfg.model === 'zipfer') return zipfer(cfg);
    return orig(cfg);
  };
})();
