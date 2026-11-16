/* =====================================================================
   Fußgänger am Zebrastreifen (nur auf Maps mit track.crossing)
   Ein paar Leute spazieren gemütlich über die Rennstrecke, warten
   drüben kurz und gehen wieder zurück. Wer erwischt wird, fliegt
   durch die Luft, bleibt kurz liegen und kommt später wieder.
   Die Belohnung zahlt main.js (onHit).
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const SIDE = 16.5;                 // Wartepunkt hinter der Mauer (seitlicher Abstand zur Streckenmitte)
  const GRAV = 9.81;
  const SHIRTS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xfb8c00, 0x8e24aa, 0xffffff, 0x00acc1, 0xec407a];
  const PANTS = [0x263238, 0x3949ab, 0x5d4037, 0x455a64, 0x212121, 0x8d6e63];
  const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  const HAIR = [0x2b1b0e, 0x5a3a1a, 0xd9b650, 0x111111, 0x9e9e9e, 0xa0412d];
  const pick = (a) => a[(Math.random() * a.length) | 0];

  // Einfache Figur, Blickrichtung +Z, Füße auf y = 0
  function figure() {
    const toon = E46.toon, root = new T.Group(), body = new T.Group(); root.add(body);
    const shirt = toon(pick(SHIRTS)), pants = toon(pick(PANTS)), skin = toon(pick(SKIN)), hair = toon(pick(HAIR)), shoe = toon(0x1b1b1b);
    const box = (w, h, d, m, x, y, z, parent) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; (parent || body).add(o); return o; };
    const limb = (x, y, parent) => { const g = new T.Group(); g.position.set(x, y, 0); (parent || body).add(g); return g; };
    box(0.44, 0.6, 0.26, shirt, 0, 1.22, 0);                       // Oberkörper
    box(0.4, 0.14, 0.24, pants, 0, 0.88, 0);                       // Hüfte
    const head = new T.Mesh(new T.SphereGeometry(0.13, 12, 10), skin); head.position.set(0, 1.68, 0); head.castShadow = true; body.add(head);
    const cap = new T.Mesh(new T.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); cap.position.set(0, 1.69, -0.01); body.add(cap);
    box(0.12, 0.1, 0.06, skin, 0, 1.53, 0);                        // Hals
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const leg = limb(s * 0.11, 0.86);
      box(0.16, 0.8, 0.18, pants, 0, -0.4, 0, leg);
      box(0.17, 0.08, 0.28, shoe, 0, -0.82, 0.05, leg);
      legs.push(leg);
      const arm = limb(s * 0.29, 1.48);
      box(0.12, 0.56, 0.13, shirt, 0, -0.26, 0, arm);
      box(0.1, 0.1, 0.1, skin, 0, -0.58, 0, arm);
      arms.push(arm);
    }
    return { root, body, legs, arms };
  }

  function create(track, opts) {
    const C = track.crossing;
    if (!C) return null;
    const onHit = (opts && opts.onHit) || (() => {});
    const group = new T.Group(); track.world.add(group);
    // Weltposition aus (entlang, seitlich) relativ zum Zebrastreifen
    const at = (along, lat) => ({ x: C.x + C.tx * along + C.rx * lat, z: C.z + C.tz * along + C.rz * lat });
    const peds = [];
    const COUNT = 4;
    function reset(p, first) {
      p.side = Math.random() < 0.5 ? -1 : 1;            // startet auf dieser Seite
      p.lat = p.side * SIDE;
      p.along = (Math.random() * 2 - 1) * (C.half - 0.6);
      p.speed = 1.1 + Math.random() * 0.7;
      p.wait = first ? Math.random() * 14 : 2 + Math.random() * 6;
      p.state = 'wait'; p.phase = Math.random() * 6; p.vy = 0; p.y = 0;
      p.f.root.visible = true; p.f.body.rotation.set(0, 0, 0); p.f.body.position.set(0, 0, 0);
      p.f.root.scale.setScalar(0.92 + Math.random() * 0.16);
      place(p);
    }
    function place(p) {
      const w = at(p.along, p.lat);
      p.f.root.position.set(w.x, p.y, w.z);
      // beim Gehen in Laufrichtung schauen, beim Warten zur Strecke
      const dir = p.state === 'walk' ? -p.side : -Math.sign(p.lat || 1);
      const fx = C.rx * dir, fz = C.rz * dir;
      p.f.root.rotation.set(0, Math.atan2(fx, fz), 0);
    }
    for (let i = 0; i < COUNT; i++) { const p = { f: figure() }; group.add(p.f.root); reset(p, true); peds.push(p); }

    function animate(p, dt, moving) {
      p.phase += dt * (moving ? p.speed * 5.2 : 0);
      const s = moving ? Math.sin(p.phase) * 0.6 : 0;
      p.f.legs[0].rotation.x = s; p.f.legs[1].rotation.x = -s;
      p.f.arms[0].rotation.x = -s * 0.8; p.f.arms[1].rotation.x = s * 0.8;
      p.f.body.position.y = moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0;
    }

    // car: { x, z, h, vx, vz, speed, halfL, halfW }
    function update(dt, car) {
      const fx = Math.cos(car.h), fz = -Math.sin(car.h), rx = Math.sin(car.h), rz = Math.cos(car.h);
      for (const p of peds) {
        if (p.state === 'wait') {
          animate(p, dt, false);
          p.wait -= dt;
          if (p.wait <= 0) { p.state = 'walk'; place(p); }
        } else if (p.state === 'walk') {
          p.lat -= p.side * p.speed * dt;
          animate(p, dt, true);
          if (p.side * p.lat <= -SIDE) { p.lat = -p.side * SIDE; p.side = -p.side; p.state = 'wait'; p.wait = 1.5 + Math.random() * 5; }
          place(p);
        } else if (p.state === 'fly') {
          p.vy -= GRAV * dt;
          p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(0, p.y + p.vy * dt);
          p.f.body.rotation.x += p.spin * dt; p.f.body.rotation.z += p.spin * 0.4 * dt;
          if (p.y <= 0 && p.vy < 0) {
            if (p.vy < -2.5) { p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }     // kleiner Hupfer beim Aufprall
            else { p.state = 'down'; p.t = 0; p.f.body.rotation.set(-Math.PI / 2, 0, Math.random() - 0.5); p.f.body.position.y = 0.15; }
          }
          p.f.root.position.set(p.x, p.y, p.z);
        } else if (p.state === 'down') {
          p.t += dt;
          if (p.t > 4) p.f.root.visible = false;
          if (p.t > 9) reset(p, false);
        }
        // Treffer? (Figur ins Fahrzeug-Koordinatensystem drehen)
        if ((p.state === 'walk' || p.state === 'wait') && car && car.speed > 2) {
          const pp = p.f.root.position, dx = pp.x - car.x, dz = pp.z - car.z;
          const lx = dx * fx + dz * fz, lz = dx * rx + dz * rz;
          if (Math.abs(lx) < car.halfL + 0.3 && Math.abs(lz) < car.halfW + 0.3) {
            const sp = Math.min(car.speed, 40);
            p.state = 'fly'; p.x = pp.x; p.z = pp.z; p.y = 0;
            // nach vorne weg (etwas schneller als das Auto) und zur Seite, auf der er getroffen wurde
            const side = (lz >= 0 ? 1 : -1) * (2.5 + Math.random() * 2.5 + sp * 0.12);
            p.vx = car.vx * 1.1 + rx * side; p.vz = car.vz * 1.1 + rz * side;
            p.vy = 4 + sp * 0.3; p.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + sp * 0.3);
            animate(p, 0, false);
            p.f.arms[0].rotation.z = 1.2; p.f.arms[1].rotation.z = -1.2;      // Arme hoch
            onHit(sp);
          }
        }
        if (p.state === 'wait' || p.state === 'walk') { p.f.arms[0].rotation.z = 0; p.f.arms[1].rotation.z = 0; }
      }
    }
    // Für Screenshot-Tests: alle sofort losgehen lassen, einer steht mitten auf der Fahrbahn
    function test() { peds.forEach((p, i) => { p.state = i ? 'walk' : 'wait'; p.wait = 99; p.along = i ? p.along : 0; p.lat = i ? p.side * (4 + i * 3) : 0; place(p); }); }
    const count = () => peds.length, hits = () => peds.filter(p => p.state === 'fly' || p.state === 'down').length;
    return { update, group, test, count, hits };
  }

  window.Peds = { create };
})();
