/* =====================================================================
   Polizei-Film: Bauteile für die Amtshandlung beim Moped
   - Polizist (österreichische Uniform, Kappe, „POLIZEI“ am Rücken)
   - mobiler Rollenprüfstand („Walze“) mit Auffahrrampe, Vorderrad-
     Wippe, zwei Rollen und Digitalanzeige auf einem Ständer
   - abgenommenes Kennzeichen („Taferl“) für die Hand des Polizisten
   Koordinaten wie überall: Figur schaut nach +Z, Prüfstand: +X vorne
   (Fahrtrichtung des Mopeds), Ursprung = Mitte der Rollen am Boden.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;

  function label(text, w, h, bg, fg, font) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 256, 64); }
    g.fillStyle = fg; g.font = font || '900 40px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34, 240);
    const t = new T.CanvasTexture(c);
    return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t, transparent: !bg }));
  }

  // ---------- Polizist ----------
  function buildCop() {
    const toon = E46.toon;
    const navy = toon(0x1f2b4d), jacket = toon(0x26365f), skin = toon(0xe8bb97), black = toon(0x141414), white = toon(0xf2f2f2), gold = toon(0xd9b54a);
    const root = new T.Group(), body = new T.Group(); root.add(body);
    const box = (w, h, d, m, x, y, z, parent) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; (parent || body).add(o); return o; };
    const pivot = (x, y, z, parent) => { const g = new T.Group(); g.position.set(x, y, z); (parent || body).add(g); return g; };
    const torso = pivot(0, 0.9, 0);                                   // Oberkörper (kann sich bücken)
    box(0.46, 0.62, 0.28, jacket, 0, 0.33, 0, torso);
    box(0.47, 0.07, 0.29, black, 0, 0.03, 0, torso);                  // Gürtel
    box(0.06, 0.05, 0.02, gold, 0.12, 0.5, 0.145, torso);             // Dienstabzeichen
    box(0.42, 0.07, 0.02, toon(0xd0141e), 0, 0.42, -0.145, torso);    // roter Streifen hinten
    const back = label('POLIZEI', 0.4, 0.1, null, '#ffffff'); back.position.set(0, 0.3, -0.146); back.rotation.y = Math.PI; torso.add(back);
    const head = new T.Mesh(new T.SphereGeometry(0.13, 14, 10), skin); head.position.set(0, 0.78, 0); head.castShadow = true; torso.add(head);
    box(0.11, 0.08, 0.06, skin, 0, 0.66, 0, torso);
    // Dienstkappe mit Schirm und Kokarde
    const cap = new T.Mesh(new T.CylinderGeometry(0.15, 0.135, 0.11, 18), navy); cap.position.set(0, 0.9, 0); cap.castShadow = true; torso.add(cap);
    const capTop = new T.Mesh(new T.CylinderGeometry(0.16, 0.15, 0.03, 18), navy); capTop.position.set(0, 0.965, 0); torso.add(capTop);
    box(0.24, 0.015, 0.1, black, 0, 0.855, 0.13, torso);              // Schirm
    box(0.3, 0.03, 0.005, gold, 0, 0.88, 0.14, torso);                // goldene Kordel
    const kok = new T.Mesh(new T.CircleGeometry(0.025, 12), toon(0xd0141e)); kok.position.set(0, 0.92, 0.152); torso.add(kok);
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const leg = pivot(s * 0.11, 0.88, 0);
      box(0.17, 0.82, 0.19, navy, 0, -0.41, 0, leg);
      box(0.18, 0.08, 0.3, black, 0, -0.84, 0.05, leg);
      legs.push(leg);
      const arm = pivot(s * 0.3, 0.58, 0, torso);
      box(0.13, 0.58, 0.14, jacket, 0, -0.27, 0, arm);
      box(0.1, 0.1, 0.1, skin, 0, -0.6, 0, arm);
      arms.push(arm);
    }
    // Taferl in der Hand (erst nach dem Abnehmen sichtbar)
    const plate = plateMesh(); plate.position.set(0, -0.66, 0.08); plate.rotation.set(0, 0, 0); plate.visible = false; arms[1].add(plate);
    let ph = 0;
    // pose: { walk: Geschwindigkeit in m/s, carry 0..1, bend 0..1, reach 0..1 (Arme zum Lenker), wave }
    function pose(dt, p) {
      ph += dt * (p.walk || 0) * 4.2;
      const sw = p.walk ? Math.sin(ph) * 0.55 : 0, carry = p.carry || 0, bend = p.bend || 0, reach = p.reach || 0;
      legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
      torso.rotation.x = bend * 0.95;
      body.position.y = (p.walk ? Math.abs(Math.cos(ph)) * 0.035 : 0) - bend * 0.12;
      for (let i = 0; i < 2; i++) {
        const free = (i ? -sw : sw) * 0.7;
        arms[i].rotation.x = free * (1 - Math.max(carry, reach)) - 1.25 * carry - 1.05 * reach - bend * 0.5;
        arms[i].rotation.z = (i ? -1 : 1) * 0.06;
      }
      if (p.wave) { arms[1].rotation.x = -2.6 + Math.sin(performance.now() / 120) * 0.25; arms[1].rotation.z = -0.25; }
    }
    pose(0, {});
    return { root, pose, plate, hands: arms };
  }

  function plateMesh() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 80); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(3, 3, 122, 74);
    g.fillStyle = '#d0141e'; g.fillRect(6, 6, 116, 12); g.fillRect(6, 62, 116, 12);
    g.fillStyle = '#111'; g.font = '900 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GM 50', 64, 41);
    const m = new T.Mesh(new T.BoxGeometry(0.16, 0.1, 0.006), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c) }));
    return m;
  }

  // ---------- Rollenprüfstand ----------
  // wb = Radstand des Mopeds, R = Radradius; liefert auch die Höhe, um die das Moped angehoben wird
  function buildDyno(wb, R) {
    const real = E46.mat.real, toon = E46.toon;
    const steel = real(0x3a3f47, 0.5, 0.6), yellow = toon(0xf2c21b), black = toon(0x17181b), chrome = real(0xd8dce0, 0.15, 1), rubber = real(0x1a1a1a, 0.9, 0);
    const root = new T.Group();
    const RR = 0.075, A = 0.13, RY = 0.13;                            // Rollen: Radius, halber Abstand, Achshöhe
    const lift = RY + Math.sqrt((R + RR) * (R + RR) - A * A) - R;      // so weit hebt das Moped ab
    const box = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; root.add(o); return o; };
    // Rahmen unter den Rollen, mit Warnstreifen
    const hz = canvasStripes();
    box(0.62, 0.1, 0.62, steel, 0, 0.05, 0);
    for (const s of [-1, 1]) { const st = box(0.64, 0.12, 0.04, new T.MeshBasicMaterial({ map: hz }), 0, 0.07, s * 0.32); st.castShadow = false; }
    const rollers = [];
    for (const s of [-1, 1]) {
      const r = new T.Group(); r.position.set(s * A, RY, 0); root.add(r);
      const cyl = new T.Mesh(new T.CylinderGeometry(RR, RR, 0.5, 20).rotateX(Math.PI / 2), chrome); cyl.castShadow = true; r.add(cyl);
      for (let k = 0; k < 6; k++) { const ln = new T.Mesh(new T.BoxGeometry(0.012, 0.012, 0.5), black); const a = k / 6 * Math.PI * 2; ln.position.set(Math.cos(a) * RR, Math.sin(a) * RR, 0); r.add(ln); }   // Rillen, damit man das Drehen sieht
      rollers.push(r);
    }
    // Laufsteg zum Vorderrad und Vorderrad-Wippe (gleiche Höhe wie das angehobene Moped)
    box(wb - 0.2, 0.06, 0.28, steel, wb / 2, 0.03, 0);
    box(0.62, lift, 0.34, steel, wb + 0.05, lift / 2, 0);
    for (const s of [-1, 1]) box(0.5, 0.14, 0.03, yellow, wb + 0.05, lift + 0.07, s * 0.1);   // Klemmbacken fürs Vorderrad
    // Auffahrrampe vorne (Moped wird rückwärts hinaufgeschoben)
    const ramp = new T.Mesh(new T.BoxGeometry(0.62, 0.03, 0.32), steel);
    const rl = 0.62, ang = Math.atan2(lift, rl - 0.05);
    ramp.position.set(wb + 0.36 + Math.cos(ang) * rl / 2, lift / 2, 0); ramp.rotation.z = -ang; ramp.castShadow = true; root.add(ramp);
    // Ständer mit Digitalanzeige (rechts neben den Rollen, schräg nach hinten gedreht)
    const post = new T.Mesh(new T.CylinderGeometry(0.03, 0.04, 1.15, 10), steel); post.position.set(-0.1, 0.575, 0.78); root.add(post);
    const foot = new T.Mesh(new T.CylinderGeometry(0.2, 0.22, 0.04, 16), steel); foot.position.set(-0.1, 0.02, 0.78); root.add(foot);
    const scr = new T.Group(); scr.position.set(-0.1, 1.28, 0.78); scr.rotation.y = -Math.PI / 4 + Math.PI; root.add(scr);
    scr.add(new T.Mesh(new T.BoxGeometry(0.62, 0.36, 0.08), black));
    const c = document.createElement('canvas'); c.width = 256; c.height = 148;
    const tex = new T.CanvasTexture(c);
    const face = new T.Mesh(new T.PlaneGeometry(0.56, 0.32), new T.MeshBasicMaterial({ map: tex })); face.position.z = -0.041; face.rotation.y = Math.PI; scr.add(face);
    const back = face.clone(); back.position.z = 0.041; back.rotation.y = 0; scr.add(back);   // Anzeige auf beiden Seiten
    const glow = new T.PointLight(0xff3b2b, 0, 3, 2); glow.position.set(0, 0, 0.3); scr.add(glow);
    // Kabel vom Ständer zur Rolle
    const cable = new T.Mesh(new T.TorusGeometry(0.35, 0.01, 6, 20, Math.PI), black); cable.position.set(-0.1, 0.02, 0.43); cable.rotation.set(Math.PI / 2, 0, Math.PI / 2); root.add(cable);
    let lastTxt = '';
    // Anzeige: Messwert in km/h, Status 'ready' | 'run' | 'bad'
    function display(kmh, status) {
      const txt = Math.round(kmh) + status;
      if (txt === lastTxt) return; lastTxt = txt;
      const g = c.getContext('2d'), bad = status === 'bad', blink = bad && (performance.now() / 250 | 0) % 2;
      g.fillStyle = '#050607'; g.fillRect(0, 0, 256, 148);
      g.fillStyle = '#7d8696'; g.font = '700 16px Arial'; g.textAlign = 'left'; g.fillText('POLIZEI · ROLLENPRÜFSTAND', 12, 20);
      const over = kmh > 45.5;
      g.fillStyle = bad ? (blink ? '#ffffff' : '#ff2a2a') : over ? '#ff5a3a' : '#5dff7a';
      g.font = '900 72px "Courier New", monospace'; g.textAlign = 'right'; g.fillText(String(Math.round(kmh)).padStart(3, ' '), 186, 92);
      g.font = '900 20px Arial'; g.textAlign = 'left'; g.fillText('km/h', 192, 90);
      g.fillStyle = '#9aa3b5'; g.font = '700 16px Arial'; g.fillText('ERLAUBT: 45 km/h', 12, 128);
      if (status === 'bad' || (status === 'run' && over)) { g.fillStyle = blink ? '#ffffff' : '#ff2a2a'; g.font = '900 18px Arial'; g.textAlign = 'right'; g.fillText(bad ? 'FRISIERT!' : 'ZU SCHNELL', 248, 128); }
      tex.needsUpdate = true;
      glow.intensity = status === 'ready' ? 0 : (over ? 1.4 : 0.6); glow.color.setHex(over ? 0xff3b2b : 0x5dff7a);
    }
    display(0, 'ready');
    root.traverse(o => { if (o.isMesh && o.material && o.material.type !== 'MeshBasicMaterial') o.castShadow = true; });
    return { root, lift, rollers, RR, display };
  }
  function canvasStripes() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#f2c21b'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#17181b';
    for (let x = -32; x < 160; x += 24) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 12, 32); g.lineTo(x + 28, 0); g.lineTo(x + 16, 0); g.fill(); }
    return new T.CanvasTexture(c);
  }

  window.CopShow = { buildCop, buildDyno };
})();
