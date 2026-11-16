/* =====================================================================
   Traktor (Ackerschlepper) – eigenes Fahrzeug aus Grundkörpern
   Koordinaten wie bei den Autos: +X vorne, +Y oben, +Z rechts,
   Ursprung Mitte Radstand am Boden. Hinterachse treibt an.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;

  // Maße
  const AXF = 1.35, AXR = -1.25;          // Vorder-/Hinterachse
  const RR = 0.82, WR = 0.46, TR = 0.86;  // Hinterrad: Radius, Breite, Spur (Radmitte)
  const RF = 0.52, WF = 0.30, TF = 0.78;  // Vorderrad
  const XF = 2.27, XR = -2.0;

  // mehrere Geometrien zu einer zusammenfassen (weniger Draw-Calls)
  function merge(list) {
    const pos = [], nrm = [];
    for (const g0 of list) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    return g;
  }
  const box = (sx, sy, sz, x, y, z) => { const g = new T.BoxGeometry(sx, sy, sz); g.translate(x || 0, y || 0, z || 0); return g; };
  // abgerundeter Kasten entlang X (für Motorhaube, Dach)
  function roundBox(x0, x1, y0, y1, hw, r) {
    const s = new T.Shape(), w = hw, h = y1 - y0;
    s.moveTo(-w + r, 0); s.lineTo(w - r, 0); s.quadraticCurveTo(w, 0, w, r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h);
    s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, r); s.quadraticCurveTo(-w, 0, -w + r, 0);
    const g = new T.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3, curveSegments: 6 });
    g.rotateY(Math.PI / 2); g.translate(x0, y0, 0);
    return g;
  }

  // Reifen mit Stollen im Pfeilprofil
  function tireGeo(R, W, lugs, lugH, rimR) {
    const parts = [];
    const tire = new T.CylinderGeometry(R - lugH, R - lugH, W, 40, 1, true); tire.rotateX(Math.PI / 2); parts.push(tire);
    // Reifenflanken als Ringe (innen offen, damit die Felge sichtbar ist)
    for (const sz of [-1, 1]) { const ring = new T.RingGeometry(rimR, R - lugH, 40, 1); if (sz < 0) ring.rotateY(Math.PI); ring.translate(0, 0, sz * W / 2); parts.push(ring); }
    // Flankenwulst
    const side = new T.TorusGeometry(R - lugH - 0.02, 0.05, 8, 40);
    parts.push(side.clone().translate(0, 0, W / 2 - 0.03), side.clone().translate(0, 0, -W / 2 + 0.03));
    for (let i = 0; i < lugs; i++) {
      const a = i / lugs * Math.PI * 2;
      for (const s of [-1, 1]) {
        const g = new T.BoxGeometry(0.075 * R / 0.8, lugH * 1.6, W * 0.52);
        g.rotateY(s * 0.55);                       // schräg -> Pfeilprofil
        g.translate(s * 0.04, R - lugH * 0.5, s * W * 0.24);
        g.rotateZ(a + (s > 0 ? 0 : Math.PI / lugs));
        parts.push(g);
      }
    }
    return merge(parts);
  }
  function rimGeo(R, W) {
    const parts = [];
    const dish = new T.CylinderGeometry(R, R, W * 0.86, 32, 1, true); dish.rotateX(Math.PI / 2); parts.push(dish);
    const disc = new T.CylinderGeometry(R * 0.92, R * 0.92, 0.03, 32); disc.rotateX(Math.PI / 2); disc.translate(0, 0, W * 0.1); parts.push(disc);
    const lip = new T.TorusGeometry(R, 0.018, 6, 32); parts.push(lip.clone().translate(0, 0, W * 0.43), lip.clone().translate(0, 0, -W * 0.43));
    // Lochkranz-Aussparungen als kleine Ringe
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const g = new T.TorusGeometry(R * 0.14, 0.012, 5, 14); g.translate(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, W * 0.12); parts.push(g); }
    return merge(parts);
  }
  function hubGeo(R, W) {
    const parts = [];
    const hub = new T.CylinderGeometry(R * 0.26, R * 0.3, 0.12, 20); hub.rotateX(Math.PI / 2); hub.translate(0, 0, W * 0.16); parts.push(hub);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const g = new T.CylinderGeometry(0.016, 0.016, 0.05, 6); g.rotateX(Math.PI / 2); g.translate(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2, W * 0.24); parts.push(g); }
    return merge(parts);
  }

  function create(cfg) {
    const M = E46.mat, real = M.real, carPaint = M.carPaint;
    const SP = window.CAR_MODELS.tractor;
    const root = new T.Group(); root.name = 'tractor';
    const chassis = new T.Group(); root.add(chassis);
    const body = new T.Group(); chassis.add(body);

    const mats = {
      paint: carPaint(cfg.paint != null ? cfg.paint : 0xc8312a, { roughness: 0.45 }),
      dark: real(0x1b1c1f, 0.6, 0.2),
      steel: real(0x55595f, 0.45, 0.8),
      chrome: real(0xd8dce0, 0.12, 1),
      rubber: real(0x161616, 0.9, 0, { envMapIntensity: 0.4 }),
      rim: real(cfg.rimColor != null ? cfg.rimColor : 0xd9b52a, 0.35, 0.4),
      glass: new T.MeshPhysicalMaterial({ color: 0x1c2833, transparent: true, opacity: 0.35, roughness: 0.04, metalness: 0, envMap: M.envMap(), envMapIntensity: 1.4, depthWrite: false, side: T.DoubleSide }),
      seat: real(0x222326, 0.8, 0),
      light: new T.MeshBasicMaterial({ color: 0xfff6dc }),
      tail: new T.MeshBasicMaterial({ color: 0xa50e17 }),
      amber: new T.MeshBasicMaterial({ color: 0xf29a1e }),
      skin: real(0xe8b48a, 0.7, 0), shirt: real(0x3d5a2a, 0.9, 0), cap: real(0xc8312a, 0.8, 0)
    };
    const add = (g, m, parent) => { const o = new T.Mesh(g, m); o.castShadow = true; (parent || body).add(o); return o; };

    // --- Rahmen, Motor, Haube ---
    const heads = [];                                                             // Scheinwerfer (Lichthupe)
    add(box(2.1, 0.36, 0.64, 0.95, 0.82, 0), mats.dark);                         // Motorblock / Rahmen
    add(roundBox(-0.05, 1.93, 1.0, 1.56, 0.43, 0.13), mats.paint);              // Motorhaube
    add(box(0.04, 0.5, 0.78, 1.97, 1.27, 0), mats.dark);                         // Kühlergrill
    for (let i = 0; i < 6; i++) add(box(0.03, 0.022, 0.72, 2.0, 1.07 + i * 0.075, 0), mats.steel);
    for (const s of [-1, 1]) {
      const hl = new T.Mesh(new T.CircleGeometry(0.075, 20), mats.light); hl.rotation.y = Math.PI / 2; hl.position.set(2.0, 1.4, s * 0.26); body.add(hl); heads.push(hl);
      add(new T.TorusGeometry(0.08, 0.012, 6, 20).rotateY(Math.PI / 2).translate(2.0, 1.4, s * 0.26), mats.chrome);
      // Seitenbleche mit Lüftungsschlitzen
      for (let i = 0; i < 4; i++) add(box(0.5, 0.025, 0.01, 1.35, 1.12 + i * 0.07, s * 0.445), mats.dark);
    }
    // Frontgewichte
    for (let i = 0; i < 5; i++) add(box(0.32, 0.075, 0.74, 2.12, 0.56 + i * 0.082, 0), i % 2 ? mats.dark : mats.steel);
    add(box(0.12, 0.42, 0.2, 1.95, 0.75, 0), mats.dark);
    // Vorderachse (Pendelachse)
    add(box(0.16, 0.14, 1.44, AXF, RF, 0), mats.dark);
    // Auspuff-Schornstein mit Regenklappe
    const ex = { x: 0.95, z: 0.27 };
    add(new T.CylinderGeometry(0.055, 0.055, 1.25, 14).translate(ex.x, 2.1, ex.z), mats.steel);
    add(new T.CylinderGeometry(0.07, 0.07, 0.4, 14).translate(ex.x, 1.75, ex.z), mats.dark);
    const flap = add(new T.CylinderGeometry(0.062, 0.062, 0.012, 14).translate(0, 0, 0), mats.steel); flap.position.set(ex.x - 0.04, 2.74, ex.z); flap.rotation.z = 0.5;
    // Luftfilter-Vorabscheider
    add(new T.CylinderGeometry(0.06, 0.06, 0.5, 12).translate(0.85, 1.75, -0.27), mats.dark);
    add(new T.CylinderGeometry(0.1, 0.08, 0.14, 14).translate(0.85, 2.05, -0.27), mats.paint);
    // Tank und Trittstufen
    for (const s of [-1, 1]) {
      add(box(0.55, 0.32, 0.18, -0.35, 0.95, s * 0.5), mats.dark);
      for (let i = 0; i < 3; i++) add(box(0.28, 0.025, 0.2, -0.05, 0.55 + i * 0.25, s * 0.68), mats.steel);
    }

    // --- Kabine ---
    const cx0 = -1.78, cx1 = -0.12, cy0 = 1.28, cy1 = 2.66, cw = 0.62;
    add(box(cx1 - cx0, 0.08, cw * 2, (cx0 + cx1) / 2, cy0, 0), mats.dark);                    // Boden
    for (const x of [cx0 + 0.04, cx1 - 0.04]) for (const s of [-1, 1]) add(box(0.07, cy1 - cy0, 0.07, x, (cy0 + cy1) / 2, s * (cw - 0.035)), mats.dark);  // Säulen
    add(roundBox(cx0 - 0.1, cx1 + 0.06, cy1 - 0.02, cy1 + 0.16, cw + 0.08, 0.06), mats.paint);   // Dach
    const glass = [
      box(0.012, cy1 - cy0 - 0.1, cw * 2 - 0.1, cx1 - 0.03, (cy0 + cy1) / 2 + 0.03, 0),          // Frontscheibe
      box(0.012, cy1 - cy0 - 0.1, cw * 2 - 0.1, cx0 + 0.03, (cy0 + cy1) / 2 + 0.03, 0)           // Heckscheibe
    ];
    for (const s of [-1, 1]) glass.push(box(cx1 - cx0 - 0.1, cy1 - cy0 - 0.1, 0.012, (cx0 + cx1) / 2, (cy0 + cy1) / 2 + 0.03, s * (cw - 0.03)));
    for (const g of glass) { const o = new T.Mesh(g, mats.glass); o.renderOrder = 3; body.add(o); }
    // Türgriff, Spiegel
    for (const s of [-1, 1]) {
      add(box(0.12, 0.02, 0.02, -0.6, 1.95, s * (cw + 0.01)), mats.chrome);
      add(box(0.32, 0.025, 0.025, cx1 - 0.02, 2.45, s * (cw + 0.16)).rotateY(0), mats.dark);
      add(box(0.04, 0.24, 0.15, cx1 - 0.02, 2.36, s * (cw + 0.32)), mats.dark);
    }
    // Arbeitsscheinwerfer und Rundumleuchte
    for (const s of [-1, 1]) for (const x of [cx1 + 0.08, cx0 - 0.12]) {
      add(box(0.08, 0.07, 0.12, x, cy1 + 0.1, s * 0.42), mats.dark);
      const wl = new T.Mesh(new T.PlaneGeometry(0.1, 0.055), mats.light); wl.rotation.y = x > 0 || x > cx0 ? Math.PI / 2 : -Math.PI / 2; wl.position.set(x + (x > cx0 ? 0.041 : -0.041), cy1 + 0.1, s * 0.42); body.add(wl);
    }
    const beacon = add(new T.CylinderGeometry(0.065, 0.075, 0.12, 14).translate(cx0 + 0.25, cy1 + 0.22, -0.4), mats.amber);
    // Innenraum: Sitz, Lenkrad, Fahrer
    add(box(0.42, 0.1, 0.46, -1.15, 1.72, 0), mats.seat);
    add(box(0.1, 0.55, 0.46, -1.38, 2.0, 0), mats.seat);
    add(new T.CylinderGeometry(0.03, 0.03, 0.6, 8).rotateZ(-0.6).translate(-0.62, 1.75, 0), mats.dark);
    add(new T.TorusGeometry(0.19, 0.018, 8, 24).rotateY(Math.PI / 2).rotateZ(-0.6).translate(-0.48, 1.98, 0), mats.dark);
    add(box(0.26, 0.5, 0.38, -1.12, 2.05, 0), mats.shirt);
    add(new T.SphereGeometry(0.11, 14, 10).translate(-1.08, 2.42, 0), mats.skin);
    add(new T.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-1.08, 2.45, 0), mats.cap);
    add(box(0.12, 0.02, 0.2, -0.97, 2.47, 0), mats.cap);
    for (const s of [-1, 1]) add(box(0.4, 0.09, 0.09, -0.85, 2.02, s * 0.17).rotateZ(0), mats.shirt);

    // --- Kotflügel hinten (mit Rückleuchten), Heckhydraulik ---
    for (const s of [-1, 1]) {
      const fg = new T.CylinderGeometry(RR + 0.08, RR + 0.08, WR + 0.14, 28, 1, true, Math.PI * 0.5, Math.PI * 0.95);
      fg.rotateX(Math.PI / 2); fg.translate(AXR, RR, s * TR);
      add(fg, mats.paint);
      const tl = new T.Mesh(new T.PlaneGeometry(0.09, 0.14), mats.tail); tl.rotation.y = -Math.PI / 2; tl.position.set(AXR - RR - 0.09, RR + 0.35, s * (TR + 0.1)); body.add(tl);
      const ind = new T.Mesh(new T.PlaneGeometry(0.09, 0.07), mats.amber); ind.rotation.y = -Math.PI / 2; ind.position.set(AXR - RR - 0.09, RR + 0.5, s * (TR + 0.1)); body.add(ind);
      add(box(0.75, 0.06, 0.06, -1.95, 0.55, s * 0.28).rotateZ(0), mats.steel);       // Unterlenker
    }
    add(box(0.55, 0.05, 0.05, -1.9, 1.05, 0), mats.steel);                              // Oberlenker
    add(new T.CylinderGeometry(0.035, 0.035, 0.2, 10).rotateZ(Math.PI / 2).translate(-1.85, 0.7, 0), mats.steel);  // Zapfwelle
    add(box(0.3, 0.3, 0.9, -1.75, 0.8, 0), mats.dark);                                  // Getriebegehäuse

    // --- Räder ---
    const wheels = [];
    const tireR = tireGeo(RR, WR, 22, 0.07, RR * 0.62), tireF = tireGeo(RF, WF, 18, 0.05, RF * 0.6);
    let rimR = rimGeo(RR * 0.62, WR), rimF = rimGeo(RF * 0.6, WF);
    const hubR = hubGeo(RR * 0.62, WR), hubF = hubGeo(RF * 0.6, WF);
    for (const front of [true, false]) for (const s of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(front ? AXF : AXR, front ? RF : RR, s * (front ? TF : TR)); chassis.add(pivot);
      const spin = new T.Group(); pivot.add(spin);
      const flip = new T.Group(); flip.rotation.y = s > 0 ? 0 : Math.PI; spin.add(flip);
      for (const [g, m] of [[front ? tireF : tireR, mats.rubber], [front ? rimF : rimR, mats.rim], [front ? hubF : hubR, mats.steel]]) { const o = new T.Mesh(g, m); o.castShadow = true; flip.add(o); }
      if (front) {   // mitlenkende Kotflügel vorne
        const fg = new T.CylinderGeometry(RF + 0.07, RF + 0.07, WF + 0.08, 20, 1, true, Math.PI * 0.62, Math.PI * 0.72);
        fg.rotateX(Math.PI / 2);
        const f = new T.Mesh(fg, mats.paint); f.castShadow = true; pivot.add(f);
      }
      wheels.push({ pivot, spin, side: s, front });
    }

    // Auspuff oben (für Ruß/Flammen)
    const exhaust = [new T.Vector3(ex.x, 2.8, ex.z)];
    let beaconT = 0;

    const api = {
      root, chassis, wheels, exhaust, model: 'tractor', spec: SP, diesel: true, isTractor: true,
      exhaustUp: true, headlights: heads, glareSize: 1.1,                                   // Ruß steigt nach oben
      cam: { d: 1.45, h: 1.85, look: 1.9 },               // Verfolgerkamera weiter weg und höher
      hoodCam: new T.Vector3(-1.0, 2.5, 0),               // Fahrersicht aus der Kabine
      lights: { tail: mats.tail, tailInner: mats.tail },
      setPaint(hex) { mats.paint.color.setHex(hex); },
      setRimStyle() {},
      setRimColor(hex) { mats.rim.color.setHex(hex); },
      setWheelOpts() {},
      setStance() {},
      setLook() {},
      setBrake(on) { mats.tail.color.setHex(on ? 0xff2633 : 0xa50e17); },
      update(st) {
        for (const w of wheels) {
          // Vorderräder sind kleiner und drehen schneller
          w.spinAngle = (w.spinAngle || 0) + (w.front ? st.frontSpin * RR / RF : st.rearSpin);
          w.spin.rotation.z = -w.spinAngle;
          w.pivot.rotation.y = w.front ? st.steer : 0;
        }
        chassis.rotation.order = 'XZY';
        chassis.rotation.x = (st.roll || 0) * 0.7;
        chassis.rotation.z = (st.pitch || 0) * 0.6;
        // Rundumleuchte blinkt
        beaconT += 0.016; mats.amber.color.setHex((beaconT * 3 % 1) < 0.5 ? 0xffb23a : 0xb5650e);
      },
      dispose() { root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); },
      dims: { XF, XR, AXF, AXR, WHEEL_R: RR, halfW: 1.1, trackHalf: TR }
    };
    return api;
  }

  // in die normale Fahrzeugerstellung einklinken
  const orig = E46.create;
  E46.create = function (cfg) {
    if (cfg && cfg.model === 'tractor') return create(cfg);
    return orig(cfg);
  };
})();
