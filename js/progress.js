/* =====================================================================
   Level, Geld & Teile-Shop
   ---------------------------------------------------------------------
   XP:    jeder geschaffte Drift gibt so viele XP wie Punkte.
   Level: von Level L auf L+1 braucht man  XP(L) = 4.000 × L^1,45
          (Level 2: 4.000 · Level 10: ca. 113.000 · Level 20: ca. 308.000)
   Geld:  pro Drift  Geld = Punkte / 50 × (1 + 2 % pro Level über 1)
          (5.000 Punkte auf Level 1 = 100 €, auf Level 11 = 120 €)
          Level-Aufstieg: Bonus von 250 € × neues Level

   Teile-Preis (eigene Formel):
     Preis = Grundpreis × Stufe^1,6 × Autofaktor × Umbau-Zuschlag
     Autofaktor     = (Serien-PS / 300)^0,6, begrenzt auf 0,4 … 1,6
                      → starke Autos zahlen mehr, das Moped weniger
     Umbau-Zuschlag = 1,3 beim Turbo für Autos ohne Serien-Turbo (Sauger,
                      E-Antrieb), weil Krümmer, Ladeluftkühler usw. dazukommen
     gerundet auf 50 €
   Benötigtes Level = Start-Level + (Stufe − 1) × Level-Abstand
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'e46drift.prog';
  const MAX_LVL = 50;

  // Teile mit Stufen – gekauft wird pro Fahrzeug
  const PARTS = {
    power:  { name: 'Motor',     stages: 6, base: 400,  lvl0: 2, lvlStep: 3, info: s => s ? '+' + s * 10 + ' % Leistung' : 'Serie' },
    turbo:  { name: 'Turbo',     stages: 5, base: 600,  lvl0: 4, lvlStep: 3, info: s => s ? '+' + Math.round(s * 20 * 0.45) + ' % Ladedruck' : 'keiner' },
    weight: { name: 'Leichtbau', stages: 5, base: 350,  lvl0: 3, lvlStep: 3, info: s => s ? '−' + s * 4 + ' % Gewicht' : 'Serie' },
    brake:  { name: 'Bremsen',   stages: 5, base: 200,  lvl0: 1, lvlStep: 2, info: s => s ? '+' + s * 10 + ' % Bremskraft' : 'Serie' },
    als:    { name: 'Anti-Lag',  stages: 1, base: 2500, lvl0: 9, lvlStep: 0, info: s => s ? 'eingebaut' : 'nur mit Turbo' }
  };
  const PART_ORDER = ['power', 'turbo', 'weight', 'brake', 'als'];
  // Reifen: 0 Straße und 3 Abgefahren gibt's gratis
  const TIRES = { 1: { lvl: 6, base: 900 }, 2: { lvl: 3, base: 500 }, 4: { lvl: 8, base: 1400 }, 5: { lvl: 12, base: 2500 } };
  // Lacke: die ersten vier sind Serie, der Rest kostet
  const PAINT_LVL = [1, 1, 1, 1, 2, 3, 4, 6, 8, 10, 12, 15, 5, 7, 9, 11, 13, 16];
  // Lack-Finish: Glanz ist Serie, der Rest wird einmal gekauft und gilt für alle Fahrzeuge
  const FINISH = [{ lvl: 1, price: 0 }, { lvl: 5, price: 1500 }, { lvl: 8, price: 2500 }, { lvl: 11, price: 3500 }, { lvl: 18, price: 8000 }];
  // Kackhaufen-Tarnung für Jonnys Rollstuhl (einmal kaufen, dann an/aus)
  const CAMO = { lvl: 1, price: 1500 };

  const round50 = (v) => Math.max(50, Math.round(v / 50) * 50);
  const carFactor = (ps) => Math.min(1.6, Math.max(0.4, Math.pow(Math.max(1, ps) / 300, 0.6)));
  const xpStep = (L) => Math.round(4000 * Math.pow(L, 1.45) / 100) * 100;

  const st = Object.assign({ xp: 0, money: 0, cars: {}, paints: [], finishes: [], camo: false }, load());
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* egal */ } }

  function levelInfo(xp) {
    let L = 1, need = xpStep(1), left = xp;
    while (left >= need && L < MAX_LVL) { left -= need; L++; need = xpStep(L); }
    return { level: L, into: left, need, max: L >= MAX_LVL };
  }
  const level = () => levelInfo(st.xp).level;
  const car = (model) => (st.cars[model] = st.cars[model] || { power: 0, turbo: 0, weight: 0, brake: 0, als: 0, tires: [] });

  // ---- Preise ----
  function partPrice(id, stage, ps, sauger) {
    const p = PARTS[id];
    return round50(p.base * Math.pow(stage, 1.6) * carFactor(ps) * (id === 'turbo' && sauger ? 1.3 : 1));
  }
  const partLevel = (id, stage) => PARTS[id].lvl0 + (stage - 1) * PARTS[id].lvlStep;
  const tirePrice = (i, ps) => TIRES[i] ? round50(TIRES[i].base * carFactor(ps)) : 0;
  const paintLevel = (i) => PAINT_LVL[i] || 1;
  const paintPrice = (i) => paintLevel(i) <= 1 ? 0 : round50(150 * Math.pow(paintLevel(i), 1.2));

  // ---- Besitz ----
  const stage = (model, id) => car(model)[id] | 0;
  const hasTire = (model, i) => !TIRES[i] || car(model).tires.indexOf(i) >= 0;
  const hasPaint = (i) => paintPrice(i) === 0 || st.paints.indexOf(i) >= 0;

  // Kaufen: gibt einen Fehlertext zurück oder null bei Erfolg
  function pay(price, lvl) {
    if (level() < lvl) return 'Erst ab Level ' + lvl;
    if (st.money < price) return 'Zu wenig Geld (' + fmt(price) + ' €)';
    st.money -= price; return null;
  }
  function buyPart(model, id, ps, sauger) {
    const c = car(model), s = (c[id] | 0) + 1;
    if (s > PARTS[id].stages) return 'Schon voll ausgebaut';
    const err = pay(partPrice(id, s, ps, sauger), partLevel(id, s)); if (err) return err;
    c[id] = s; save(); return null;
  }
  function buyTire(model, i, ps) {
    if (hasTire(model, i)) return null;
    const err = pay(tirePrice(i, ps), TIRES[i].lvl); if (err) return err;
    car(model).tires.push(i); save(); return null;
  }
  const hasFinish = (i) => !FINISH[i] || FINISH[i].price === 0 || st.finishes.indexOf(i) >= 0;
  function buyFinish(i) {
    if (hasFinish(i)) return null;
    const err = pay(FINISH[i].price, FINISH[i].lvl); if (err) return err;
    st.finishes.push(i); save(); return null;
  }
  function buyPaint(i) {
    if (hasPaint(i)) return null;
    const err = pay(paintPrice(i), paintLevel(i)); if (err) return err;
    st.paints.push(i); save(); return null;
  }

  const hasCamo = () => !!st.camo;
  function buyCamo() {
    if (st.camo) return null;
    const err = pay(CAMO.price, CAMO.lvl); if (err) return err;
    st.camo = true; save(); return null;
  }

  // Grenzen der Regler aus den gekauften Stufen
  function limits(model) {
    const c = car(model);
    return { powerMax: 100 + 10 * (c.power | 0), turboMax: 20 * (c.turbo | 0), weightMin: 100 - 4 * (c.weight | 0), brakeMax: 100 + 10 * (c.brake | 0), als: !!c.als };
  }
  // Einstellungen auf das Gekaufte begrenzen (gibt true zurück, wenn etwas geändert wurde)
  function clampCfg(cfg) {
    const L = limits(cfg.model), before = JSON.stringify([cfg.power, cfg.turbo, cfg.weightPct, cfg.brakePower, cfg.als, cfg.tires, cfg.paint, cfg.finish, !!cfg.camo]);
    if (cfg.power > L.powerMax) cfg.power = L.powerMax;
    if (cfg.turbo > L.turboMax) cfg.turbo = L.turboMax;
    if (cfg.weightPct < L.weightMin) cfg.weightPct = L.weightMin;
    if (cfg.brakePower > L.brakeMax) cfg.brakePower = L.brakeMax;
    if (cfg.als && !L.als) cfg.als = false;
    if (!hasTire(cfg.model, cfg.tires | 0)) cfg.tires = 0;
    if (!hasPaint(cfg.paint | 0)) cfg.paint = 0;
    if (!hasFinish(cfg.finish | 0)) cfg.finish = 0;
    if (cfg.camo && !st.camo) cfg.camo = false;
    return before !== JSON.stringify([cfg.power, cfg.turbo, cfg.weightPct, cfg.brakePower, cfg.als, cfg.tires, cfg.paint, cfg.finish, !!cfg.camo]);
  }

  // Drift geschafft: XP + Geld, eventuell Level-Aufstieg
  function addDrift(pts) {
    pts = Math.max(0, Math.round(pts));
    const L0 = level();
    const money = Math.round(pts / 50 * (1 + 0.02 * (L0 - 1)));
    st.xp += pts; st.money += money;
    const L1 = level();
    let bonus = 0; const unlocked = [];
    for (let L = L0 + 1; L <= L1; L++) { bonus += 250 * L; unlocked.push(...unlocksAt(L)); }
    st.money += bonus;
    save();
    return { money, level: L1, up: L1 > L0, bonus, unlocked };
  }
  // Prämie ohne XP (z. B. Fußgänger am Zebrastreifen erwischt)
  function addMoney(n) { st.money += Math.max(0, Math.round(n)); save(); return st.money; }
  function unlocksAt(L) {
    const out = [];
    for (const id of PART_ORDER) for (let s = 1; s <= PARTS[id].stages; s++) if (partLevel(id, s) === L) out.push(PARTS[id].name + (PARTS[id].stages > 1 ? ' ' + s : ''));
    for (const i in TIRES) if (TIRES[i].lvl === L) out.push(window.Physics ? Physics.TIRES[i].name : 'Reifen');
    PAINT_LVL.forEach((l, i) => { if (l === L && i >= 4 && window.E46 && E46.PAINTS[i]) out.push(E46.PAINTS[i].name); });
    FINISH.forEach((f, i) => { if (f.lvl === L && f.price && window.E46 && E46.FINISHES[i]) out.push('Finish ' + E46.FINISHES[i].name); });
    return out;
  }
  const fmt = (n) => Math.round(n).toLocaleString('de-DE');
  // Vom Admin freigeschaltet (Nachricht 'maxprog' vom Server)
  function maxAll() {
    let xp = 0; for (let L = 1; L < MAX_LVL; L++) xp += xpStep(L);
    st.xp = Math.max(st.xp || 0, xp); st.money = Math.max(st.money || 0, 99999999);
    for (const id in (window.CAR_MODELS || {})) { const c = { tires: Object.keys(TIRES).map(Number) }; for (const k of PART_ORDER) c[k] = PARTS[k].stages; st.cars[id] = c; }
    st.paints = ((window.E46 && E46.PAINTS) || []).map((_, i) => i); st.finishes = FINISH.map((_, i) => i); st.camo = true;
    save();
  }

  window.Prog = {
    PARTS, PART_ORDER, TIRES, FINISH, hasFinish, buyFinish, CAMO, hasCamo, buyCamo, maxAll, level, levelInfo: () => levelInfo(st.xp), xpStep, carFactor,
    partPrice, partLevel, tirePrice, paintPrice, paintLevel, stage, hasTire, hasPaint,
    buyPart, buyTire, buyPaint, limits, clampCfg, addDrift, addMoney, money: () => st.money
  };
})();
