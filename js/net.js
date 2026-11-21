/* =====================================================================
   LAN-Multiplayer (Client): Verbindung, fremde Autos, Auto-zu-Auto-Kontakt
   Jeder Spieler berechnet sein eigenes Auto, sendet den Zustand 20x/s;
   fremde Autos werden mit ~120 ms Verzögerung weich interpoliert.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const SEND_HZ = 20, DELAY = 0.12;
  const available = location.protocol === 'http:' || location.protocol === 'https:';

  const Net = {
    available, connected: false, myId: null, slot: 0, urls: [], status: available ? 'Verbinde …' : 'offline',
    remotes: new Map(), onChange: null, onEvent: null, onChat: null,
    _ws: null, _sendT: 0, _ctx: null, _retry: 0
  };

  function tagTexture(name, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(16,18,24,0.85)';
    g.beginPath(); if (g.roundRect) g.roundRect(4, 8, 248, 48, 12); else g.rect(4, 8, 248, 48); g.fill();
    g.fillStyle = color; g.fillRect(4, 8, 10, 48);
    g.font = 'italic 900 30px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.fillText(name, 134, 34, 220);
    return new T.CanvasTexture(c);
  }
  const SLOT_COLORS = ['#ffd21f', '#4fc3ff', '#ff5ab0', '#5dff8a', '#ff8a3d', '#b98cff', '#ff4d4d', '#2fe0c8', '#f4f4f4', '#9ad13b', '#ff9ed2', '#3d7bff', '#c9a33a', '#e056fd', '#7fd9ff', '#ff6f61', '#8fe38f', '#d0a5ff', '#ffb347', '#9aa3b5'];   // eine Farbe je Spielerplatz (bis 20)

  function carCfg(cfg) {
    cfg = cfg || {};
    const P = E46.PAINTS[cfg.paint | 0] || E46.PAINTS[0], R = E46.RIM_COLORS[cfg.rimColor | 0] || E46.RIM_COLORS[0];
    const eng = window.Physics && Physics.engineOf ? Physics.engineOf(Object.assign({}, cfg, { model: window.CAR_MODELS[cfg.model] ? cfg.model : 'e46' })) : null;
    return { badge: eng ? eng.badge : null, diesel: eng ? !!eng.diesel : false, rimSize: cfg.rimSize == null ? 1 : cfg.rimSize, letters: !!cfg.letters, lip: (E46.LIP_COLORS[cfg.lipColor | 0] || E46.LIP_COLORS[0]).hex, model: (window.CAR_MODELS[cfg.model] ? cfg.model : 'e46'), plate: E46.lookFromCfg(cfg).plate, paint: P.hex, rimStyle: cfg.rimStyle | 0, rimColor: R.hex, drop: (cfg.drop != null ? cfg.drop : 6) / 100, camber: cfg.camber != null ? cfg.camber : 5, track: (cfg.track != null ? cfg.track : 3) / 100 };
  }

  // Fremde Autos nicht alle im selben Frame aufbauen (beim Beitritt kommen bis zu 19 auf einmal):
  // Warteschlange, ein Auto pro Frame
  const pending = new Map();
  let pumping = false;
  function pump() {
    const it = pending.values().next();
    if (it.done) { pumping = false; return; }
    pending.delete(it.value.id);
    buildRemote(it.value);
    requestAnimationFrame(pump);
  }
  function addRemote(p) {
    if (!Net._ctx || Net.remotes.has(p.id)) return;
    pending.set(p.id, Object.assign({}, p));
    if (!pumping) { pumping = true; requestAnimationFrame(pump); }
  }
  function buildRemote(p) {
    const ctx = Net._ctx;
    if (!ctx || Net.remotes.has(p.id)) return;
    const cc = carCfg(p.cfg);
    const car = E46.create(cc);
    car.setLook(E46.lookFromCfg(p.cfg)); car.setWheelOpts({ lip: cc.lip });
    car.root.traverse(o => { if (o.isMesh) o.castShadow = o.material && o.material.type !== 'ShaderMaterial'; });
    car.root.visible = false;
    ctx.scene.add(car.root);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tagTexture(p.name, SLOT_COLORS[p.slot % SLOT_COLORS.length]), depthWrite: false }));
    sprite.scale.set(2.6, 0.65, 1); sprite.position.y = 2.3; sprite.renderOrder = 5;
    car.root.add(sprite);
    Net.remotes.set(p.id, { id: p.id, slot: p.slot, name: p.name, cfg: p.cfg, car, sprite, snaps: [], total: p.total || 0, best: p.best || 0, bestCar: p.bestCar || null, away: true, smokeAcc: [0, 0], cur: null });
    changed();
  }
  function removeRemote(id) {
    pending.delete(id);
    const r = Net.remotes.get(id); if (!r) return;
    if (r.car.root.parent) r.car.root.parent.remove(r.car.root);
    for (const k of ['l', 'r']) Net._ctx.skids.lift(id + k);
    Net.remotes.delete(id);
    changed();
  }
  function changed() { if (Net.onChange) Net.onChange(); }
  // Geräte-Kennung: unter dieser ID speichert der Server deine geprüften Rekorde
  const UID = (() => {
    try {
      let u = localStorage.getItem('e46drift.uid');
      if (!/^[a-f0-9]{32}$/.test(u || '')) { u = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('e46drift.uid', u); }
      return u;
    } catch (e) { return null; }
  })();
  function send(obj) { if (Net._ws && Net._ws.readyState === 1) Net._ws.send(JSON.stringify(obj)); }

  Net.init = function (ctx) { Net._ctx = ctx; };

  Net.connect = function (name, cfg) {
    if (!available) return;
    Net._name = name; Net._cfg = cfg;
    let ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host); } catch (e) { Net.status = 'Keine Verbindung'; changed(); return; }
    Net._ws = ws;
    Net.status = 'Verbinde …'; changed();
    ws.onopen = () => send({ t: 'hello', uid: UID, name, cfg, best: Math.round(Net.myBest || 0), bestCar: Net.myBestCar || null });
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    ws.onclose = onClose;
  };

  function handle(m) {
    switch (m.t) {
      case 'welcome':
        // Server wurde mit neuer Version neu gestartet → Seite neu laden (Fortschritt liegt im localStorage)
        if (m.version && Net._version && m.version !== Net._version) {
          Net.status = 'Neue Version – lädt neu …'; changed();
          if (Net.onEvent) Net.onEvent('Neue Version – Seite lädt neu');
          setTimeout(() => location.reload(), 1500);
          return;
        }
        if (m.version) Net._version = m.version;
        Net.connected = true; Net.myId = m.id; Net.slot = m.slot; Net.urls = m.urls || []; Net.max = m.max;
        Net.status = 'Verbunden'; Net._retry = 0;
        for (const p of m.players) addRemote(p);
        if (m.rec && Net.onRec) Net.onRec(m.rec, false);
        if (Net.onChat) for (const c of m.chat || []) Net.onChat(Object.assign({ old: true }, c));
        changed(); break;
      case 'full': Net.status = 'Server voll (max. ' + m.max + ' Spieler)'; Net._full = true; changed(); break;
      case 'kicked': Net.status = 'Du wurdest vom Host entfernt'; Net._full = true; changed(); if (Net.onEvent) Net.onEvent('Vom Host gekickt'); break;
      case 'banned': Net.status = 'Du bist auf diesem Server gesperrt'; Net._full = true; changed(); if (Net.onEvent) Net.onEvent('Vom Host gesperrt'); break;
      case 'maxprog': if (window.Prog) {
        window.Prog.maxAll();
        send({ t: 'maxok' });
        if (Net.onEvent) Net.onEvent('Host hat dir alles freigeschaltet');
        setTimeout(() => location.reload(), 1200);
      } break;
      case 'jumpscare': if (window.Jumpscare) window.Jumpscare.play(); break;
      case 'insult': if (window.Jumpscare) window.Jumpscare.text('Du Hurensohn'); break;
      case 'join': addRemote(m); if (Net.onEvent) Net.onEvent(m.name + ' ist beigetreten'); break;
      case 'leave': { const r = Net.remotes.get(m.id); if (r && Net.onEvent) Net.onEvent(r.name + ' hat verlassen'); removeRemote(m.id); break; }
      case 's': {
        const r = Net.remotes.get(m.id); if (!r) break;
        m.at = performance.now() / 1000;
        r.snaps.push(m); if (r.snaps.length > 30) r.snaps.shift();
        r.away = false; break;
      }
      case 'away': { const r = Net.remotes.get(m.id); if (r) { r.away = true; r.snaps.length = 0; } break; }
      case 'cfg': {
        if (pending.has(m.id)) { pending.get(m.id).cfg = m.cfg; break; }
        const r = Net.remotes.get(m.id); if (!r) break;
        const c = carCfg(m.cfg), old = carCfg(r.cfg);
        r.cfg = m.cfg;
        changed();   // Bestenliste neu zeichnen (z. B. neuer Challenge-Rekord)
        if (c.model !== old.model || c.badge !== old.badge) {
          // anderes Auto gewählt: neu aufbauen, Namensschild übernehmen
          const vis = r.car.root.visible, parent = r.car.root.parent;
          r.car.root.remove(r.sprite); if (parent) parent.remove(r.car.root); r.car.dispose();
          r.car = E46.create(c); r.car.setLook(E46.lookFromCfg(m.cfg)); r.car.setWheelOpts({ lip: c.lip });
          r.car.root.traverse(o => { if (o.isMesh) o.castShadow = o.material && o.material.type !== 'ShaderMaterial'; });
          r.car.root.add(r.sprite); r.car.root.visible = vis; if (parent) parent.add(r.car.root);
          break;
        }
        r.car.setPaint(c.paint); r.car.setRimColor(c.rimColor);
        if (c.rimStyle !== old.rimStyle) r.car.setRimStyle(c.rimStyle);
        r.car.setStance({ drop: c.drop, camber: c.camber, track: c.track });
        r.car.setLook(E46.lookFromCfg(m.cfg));
        r.car.setWheelOpts({ size: c.rimSize, letters: c.letters, lip: c.lip });
        break;
      }
      case 'name': {
        if (pending.has(m.id)) { pending.get(m.id).name = m.name; break; }
        const r = Net.remotes.get(m.id); if (!r) break;
        r.name = m.name; r.sprite.material.map = tagTexture(m.name, SLOT_COLORS[r.slot % SLOT_COLORS.length]); r.sprite.material.needsUpdate = true; changed(); break;
      }
      case 'chat': if (Net.onChat) Net.onChat(m); break;
      case 'rec': if (m.rec && Net.onRec) Net.onRec(m.rec, !!m.reset); break;   // Server korrigiert deine Rekorde
      case 'score': { const q = pending.get(m.id); if (q) { q.total = m.total; if (m.best != null) { q.best = m.best; q.bestCar = m.bestCar || null; } }
        const r = Net.remotes.get(m.id); if (r) { r.total = m.total; if (m.best != null) { r.best = m.best; r.bestCar = m.bestCar || null; } changed(); } break; }
    }
  }
  Net._handle = handle;

  function onClose() {
    Net.connected = false; Net._ws = null;
    pending.clear();
    for (const id of [...Net.remotes.keys()]) removeRemote(id);
    if (Net._full) { changed(); return; }
    Net.status = 'Getrennt – neuer Versuch …'; changed();
    Net._retry = Math.min(5, Net._retry + 1);
    setTimeout(() => Net.connect(Net._name, Net._cfg), 1000 * Net._retry);
  }

  Net.sendCfg = function (cfg) { Net._cfg = cfg; send({ t: 'cfg', cfg }); };
  Net.sendName = function (name) { Net._name = name; send({ t: 'name', name }); };
  Net.sendScore = function (total, drift, best, bestCar) { if (best != null) Net.myBest = best; if (bestCar) Net.myBestCar = bestCar; send({ t: 'score', total: Math.round(total), drift: Math.round(drift), best: Math.round(Net.myBest || 0), bestCar: Net.myBestCar || null }); };
  Net.sendAway = function () { send({ t: 'away' }); };
  // Chat: getippte Nachricht bzw. Drift-Meldung; liefert false, wenn nicht verbunden
  Net.sendChat = function (text) { if (!Net.connected) return false; send({ t: 'chat', kind: 'msg', text: String(text).slice(0, 140) }); return true; };
  Net.sendDriftChat = function (kind, pts) { if (!Net.connected) return false; send({ t: 'chat', kind, pts: Math.round(pts) }); return true; };

  // eigener Zustand als Schnappschuss (wird 20x/s gesendet)
  Net.snapshot = function (ph) {
    const q = (v, k) => Math.round(v * k) / k;
    return {
      t: 's', th: q(ph.netTh != null ? ph.netTh : ph.throttle, 100), x: q(ph.x, 100), z: q(ph.z, 100), h: q(ph.h, 1000), vx: q(ph.vx, 100), vz: q(ph.vz, 100),
      st: q(ph.steer, 100), ro: q(ph.roll, 1000), pi: q(ph.pitch, 1000), u: q(ph.u, 100), sp: q(ph.spin, 10),
      sr: q(ph.slipR, 10), sf: q(ph.slipF, 10), hb: ph.hb ? 1 : 0, br: (ph.brakeIn > 0.1 || ph.reverse) ? 1 : 0,
      // für den Motorsound bei den anderen: Drehzahl, Begrenzer, Anzahl Knalle (Anti-Lag, Runterschalten, Fehlzündung)
      rp: Math.round((ph.netRpm != null ? ph.netRpm : ph.rpm) || 0), ct: ph.revCut ? 1 : 0, bg: (window.Sound && Sound.ownBangs) || 0,
      ly: q(ph.liftY || 0, 100),  // Höhe auf der Hebebühne
      gy: q(ph.groundY || 0, 100), gr: q(ph.grade || 0, 1000),   // Fahrbahnhöhe und Steigung (Brücke)
      hn: ph.horn ? 1 : 0, lf: ph.flash ? 1 : 0,   // Hupe, Lichthupe
      jy: ph.shout || 0,   // Jonnys letzter Spruch (Zähler*100 + Nummer)
      jf: ph.jonnyFall ? 1 : 0,   // Jonny ist aus dem Rollstuhl gefallen
      np: ph.noPlate ? 1 : 0,   // Moped ohne Kennzeichen (getaferlt)
      cp: ph.cop || 0           // Polizei bei diesem Spieler (Verfolgung, Film mit Prüfstand), siehe main.js copNetState
    };
  };
  // eigenen Zustand senden (gedrosselt)
  Net.tick = function (dt, ph) {
    if (!Net.connected) return;
    Net._sendT += dt;
    if (Net._sendT < 1 / SEND_HZ) return;
    Net._sendT = 0;
    send(Net.snapshot(ph));
  };

  function lerpAngle(a, b, f) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; }

  // fremde Autos darstellen
  Net.update = function (dt) {
    const ctx = Net._ctx; if (!ctx) return;
    const now = performance.now() / 1000 - DELAY;
    for (const r of Net.remotes.values()) {
      const s = r.snaps;
      const otherMap = ((r.cfg && r.cfg.map) || 'hakone') !== (Net.myMap || 'hakone');
      if (r.away || !s.length || otherMap) { r.car.root.visible = false; r.cur = null; continue; }
      let a = s[0], b = s[s.length - 1], f = 1;
      for (let i = 0; i < s.length - 1; i++) if (s[i].at <= now && s[i + 1].at >= now) { a = s[i]; b = s[i + 1]; f = (now - a.at) / Math.max(1e-3, b.at - a.at); break; }
      if (now > b.at) { a = b; f = 0; }
      const ex = now > b.at ? Math.min(0.25, now - b.at) : 0;   // kurz extrapolieren
      const cur = {
        x: a.x + (b.x - a.x) * f + b.vx * ex, z: a.z + (b.z - a.z) * f + b.vz * ex, h: lerpAngle(a.h, b.h, f),
        vx: a.vx + (b.vx - a.vx) * f, vz: a.vz + (b.vz - a.vz) * f, st: a.st + (b.st - a.st) * f,
        ro: a.ro + (b.ro - a.ro) * f, pi: a.pi + (b.pi - a.pi) * f, u: a.u + (b.u - a.u) * f, sp: b.sp, sr: b.sr, sf: b.sf, hb: b.hb, br: b.br,
        gy: (a.gy || 0) + ((b.gy || 0) - (a.gy || 0)) * f, gr: (a.gr || 0) + ((b.gr || 0) - (a.gr || 0)) * f
      };
      r.cur = cur;
      const car = r.car;
      car.root.visible = true;
      car.root.position.set(cur.x, (b.ly || 0) + cur.gy, cur.z); car.root.rotation.y = cur.h; car.root.rotation.z = Math.atan(cur.gr);
      const R = car.dims.WHEEL_R;
      car.update({ frontSpin: cur.u / R * dt, rearSpin: cur.hb ? 0 : (cur.u + cur.sp) / R * dt, steer: cur.st, roll: cur.ro, pitch: cur.pi, throttle: b.th || 0, speed: cur.u, beta: Math.atan2(cur.vx * Math.sin(cur.h) + cur.vz * Math.cos(cur.h), Math.max(0.1, Math.abs(cur.u))), dt });
      // Jonny-Sprüche der anderen: Sprechblase + Stimme (leiser je weiter weg)
      if (window.Jonny) {
        if (b.jy && r.jy != null && b.jy !== r.jy) {
          const txt = Jonny.LINES[b.jy % 100];
          if (txt) {
            Jonny.showBubble(car.root, txt, 1.95);
            const me = Net._ctx.me && Net._ctx.me(), dist = me ? Math.hypot(me.x - cur.x, me.z - cur.z) : 0;
            if (Net._ctx.soundOn && Net._ctx.soundOn()) Jonny.speak(txt, Net._ctx.volume() * Math.max(0, 1 - dist / 120));
          }
        }
        r.jy = b.jy || 0;
        if (car.fallState) {   // Sturz der anderen nachspielen
          const f = car.fallState();
          if (b.jf && f === 'seat') { car.fallOut(); Jonny.showBubble(car.root, 'AUAAA!', 1.95); }
          else if (!b.jf && f === 'down') car.climbIn();
        }
        Jonny.tickBubble(car.root, dt);
      }
      car.setBrake(!!cur.br || !!cur.hb);
      E46.setFlash(car, !!b.lf);   // Lichthupe der anderen
      if (car.setPlateOff) car.setPlateOff(!!b.np);   // getaferltes Moped ohne Kennzeichen
      // Qualm & Spuren
      const fx = Math.cos(cur.h), fz = -Math.sin(cur.h), rx = Math.sin(cur.h), rz = Math.cos(cur.h);
      const spd = Math.hypot(cur.vx, cur.vz), vdx = spd > 0.1 ? cur.vx / spd : fx, vdz = spd > 0.1 ? cur.vz / spd : fz;
      if (car.diesel && b.th > 0.2) {
        r.sootAcc = (r.sootAcc || 0) + b.th * 14 * dt;
        while (r.sootAcc >= 1) {
          r.sootAcc -= 1;
          const wp = car.chassis.localToWorld(car.exhaust[(Math.random() * car.exhaust.length) | 0].clone());
          const g = 0.14 + Math.random() * 0.08;
          ctx.smoke.emit(wp.x, wp.y, wp.z, cur.vx * 0.5 - fx * 4, 0.7 + Math.random() * 0.8, cur.vz * 0.5 - fz * 4, 0.4 + Math.random() * 0.3, 1.8, [g, g, g + 0.02]);
        }
      }
      if (car.foamAt && b.th > 0.3) {   // Bierschaum der anderen Flaschen
        r.foamAcc = (r.foamAcc || 0) + b.th * 8 * dt;
        while (r.foamAcc >= 1) {
          r.foamAcc -= 1;
          const wp = car.chassis.localToWorld(car.foamAt.clone()), g = 0.9 + Math.random() * 0.08;
          ctx.smoke.emit(wp.x, wp.y, wp.z, cur.vx * 0.7 + fx * 3, 1.2 + Math.random() * 1.4, cur.vz * 0.7 + fz * 3, 0.2 + Math.random() * 0.15, 1.1, [g, g * 0.95, g * 0.8]);
        }
      }
      if (car.twoStroke) {   // Zweitakt-Qualm der anderen Mopeds
        r.sootAcc = (r.sootAcc || 0) + (2 + (b.th || 0) * 6) * dt;
        while (r.sootAcc >= 1) {
          r.sootAcc -= 1;
          const wp = car.chassis.localToWorld(car.exhaust[0].clone()), g = 0.68 + Math.random() * 0.12;
          ctx.smoke.emit(wp.x, wp.y, wp.z, cur.vx * 0.5 - fx * 2, 0.4 + Math.random() * 0.5, cur.vz * 0.5 - fz * 2, 0.15 + Math.random() * 0.12, 1.4, [g * 0.9, g * 0.95, g + 0.08]);
        }
      }
      [1, -1].forEach((sd, k) => {
        const TW = car.dims.trackHalf, wx = cur.x + fx * car.dims.AXR + rx * sd * TW, wz = cur.z + fz * car.dims.AXR + rz * sd * TW;
        ctx.skids.add(r.id + (k ? 'l' : 'r'), wx, wz, vdx, vdz, 0.24, spd > 0.5 ? Math.max(0, Math.min(0.6, (cur.sr - 2.5) / 9)) : 0, cur.gy);
        if (cur.sr > 4) {
          r.smokeAcc[k] += dt * Math.min(42, (cur.sr - 4) * 4);
          while (r.smokeAcc[k] >= 1) {
            r.smokeAcc[k] -= 1;
            const j = () => Math.random() - 0.5;
            ctx.smoke.emit(wx + j() * 0.3, cur.gy + 0.3 + Math.random() * 0.15, wz + j() * 0.3, cur.vx * 0.3 + j() * 1.6, 0.5 + Math.random() * 0.8, cur.vz * 0.3 + j() * 1.6,
              0.7 + Math.random() * 0.5, 1.8 + Math.random() * 1.2, E46.smokeRGB(r.cfg));
          }
        }
      });
    }
  };

  // Kontakt eigenes Auto <-> fremde Autos (je 3 Kreise entlang der Länge)
  const OFFS = [-1.45, 0, 1.45], RAD = 0.92;
  Net.collide = function (ph) {
    let hit = 0;
    for (const r of Net.remotes.values()) {
      const c = r.cur; if (!c) continue;
      if (Math.abs((ph.groundY || 0) - (c.gy || 0)) > 2.5) continue;   // einer auf der Brücke, der andere drunter
      const fx = Math.cos(ph.h), fz = -Math.sin(ph.h), gx = Math.cos(c.h), gz = -Math.sin(c.h);
      for (const a of OFFS) for (const b of OFFS) {
        const ax = ph.x + fx * a, az = ph.z + fz * a, bx = c.x + gx * b, bz = c.z + gz * b;
        let dx = ax - bx, dz = az - bz; const d = Math.hypot(dx, dz);
        if (d >= 2 * RAD || d < 1e-4) continue;
        dx /= d; dz /= d;
        const pen = 2 * RAD - d;
        ph.x += dx * pen * 0.5; ph.z += dz * pen * 0.5;
        const rel = (ph.vx - c.vx) * dx + (ph.vz - c.vz) * dz;
        if (rel < 0) {
          ph.vx -= dx * rel * 0.8; ph.vz -= dz * rel * 0.8;
          ph.r *= 0.92;
          hit = Math.max(hit, -rel);
        }
      }
    }
    return hit;
  };

  Net.list = function () {
    const arr = [];
    for (const r of Net.remotes.values()) arr.push({ id: r.id, name: r.name + ((r.cfg && r.cfg.map && window.Track && Track.MAPS[r.cfg.map] && r.cfg.map !== Net.myMap) ? ' (' + Track.MAPS[r.cfg.map].name + ')' : ''), slot: r.slot, total: r.total, best: r.best || 0, chalRec: (r.cfg && r.cfg.chalRec) || {}, chalCar: (r.cfg && r.cfg.chalRecCar) || {}, lapRec: (r.cfg && r.cfg.lapRec) || {}, lapCar: (r.cfg && r.cfg.lapRecCar) || {}, bestCar: r.bestCar || (r.cfg && r.cfg.bestCar) || null, lvl: (r.cfg && r.cfg.lvl) || 1, map: (r.cfg && r.cfg.map) || 'hakone', me: false });
    return arr;
  };
  Net.slotColor = (s) => SLOT_COLORS[s % SLOT_COLORS.length];
  Net.isHost = available && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  window.Net = Net;
})();
