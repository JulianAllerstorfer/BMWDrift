/* =====================================================================
   E46 DRIFT – LAN-Multiplayer-Server (ohne Zusatzpakete, nur Node.js)
   Start:  node server.js      (oder Doppelklick auf start-multiplayer.command)
   Liefert das Spiel per HTTP aus und verbindet bis zu 20 Spieler per WebSocket.
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 8046;
const MAX_PLAYERS = 20;
const ROOT = __dirname;
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');   // Schutz gegen fremde Seiten (CSRF) für die Admin-API
// Passwort fürs Adminpanel über den öffentlichen Link. Ohne Passwort bleibt das Panel nur lokal erreichbar.
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
// Cookie-Wert hängt nur vom Passwort ab: bleibt über Neustarts gültig, wird ungültig, sobald du das Passwort änderst
const ADMIN_COOKIE = ADMIN_PASSWORD ? crypto.createHmac('sha256', ADMIN_PASSWORD).update('bmwdrift-admin-v1').digest('hex') : '';
const loginFails = new Map();                                  // IP -> { n, until } – bremst Passwort-Raten
const pendingMax = new Set();                                  // 'IP|Name' – Max wartet auf Bestätigung vom Spiel
const maxKey = (c) => c.ip + '|' + c.name;
const banned = new Map();                                      // IP -> Name (gilt bis Server-Neustart)
const cleanIp = (a) => String(a || '').replace(/^::ffff:/, '');
// Über einen Tunnel (ngrok/cloudflared) kommen Fremde scheinbar von 127.0.0.1 – erkennbar am Forwarded-Header bzw. fremden Host
const viaTunnel = (req) => !!(req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['cf-connecting-ip'])
  || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
const isLocal = (req) => ['127.0.0.1', '::1'].includes(cleanIp(req.socket.remoteAddress)) && !viaTunnel(req);
const clientIp = (req) => {
  const sock = cleanIp(req.socket.remoteAddress);
  const fwd = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (['127.0.0.1', '::1'].includes(sock) && fwd) ? cleanIp(fwd) : sock;
};
// Versionskennung aus dem Inhalt der Spieldateien – ändert sich nur, wenn sich am Spiel etwas ändert.
// Der Client lädt die Seite neu, wenn er nach einem Neustart eine andere Version sieht.
const VERSION = (() => {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || (dir === ROOT && e.name === 'data')) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(html|js|css|png|jpe?g|json)$/i.test(e.name)) { h.update(path.relative(ROOT, f)); h.update(fs.readFileSync(f)); }
    }
  };
  try { walk(ROOT); } catch (e) { h.update(String(Date.now())); }
  return h.digest('hex').slice(0, 12);
})();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };

function lanUrls() {
  const out = process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------- HTTP: statische Dateien ----------
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/admin' || p.startsWith('/admin/')) { handleAdmin(req, res, p); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA_DIR + path.sep) || path.basename(file).startsWith('.') || ['admin.html', 'server.js'].includes(path.basename(file))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
  if (p === '/index.html') console.log(`  Seite aufgerufen von ${req.socket.remoteAddress}`);
});

// ---------- Adminpanel (lokal frei, über den öffentlichen Link nur mit Passwort) ----------
function adminState() {
  return {
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, ip: p.ip, slot: p.slot, total: p.total || 0, best: p.rec.best, host: p.local, since: p.since, maxPending: pendingMax.has(maxKey(p)) })),
    records: Object.entries(recs.recs).filter(([, r]) => r.best > 0 || Object.keys(r.chal || {}).length).sort((a, b) => b[1].best - a[1].best).slice(0, 40)
      .map(([uid, r]) => ({ uid, name: r.name, best: r.best, chal: Object.values(r.chal || {}).reduce((m, v) => Math.max(m, v.pts), 0), seen: r.seen || 0 })),
    banned: [...banned.entries()].map(([ip, name]) => ({ ip, name })),
    max: MAX_PLAYERS, urls: lanUrls()
  };
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
const hasAdminCookie = (req) => !!ADMIN_COOKIE && safeEq(cookieOf(req, 'bmwadmin'), ADMIN_COOKIE);
const adminAllowed = (req) => isLocal(req) || hasAdminCookie(req);
function loginPage(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BMW Drift Admin</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1116;color:#fff;font:14px "Helvetica Neue",Arial,sans-serif;padding:16px;box-sizing:border-box}
form{background:#181b22;border:2px solid #111318;border-radius:14px;padding:22px;width:100%;max-width:340px;box-shadow:5px 5px 0 rgba(0,0,0,.4)}
h1{font:900 28px "Arial Black",Arial,sans-serif;margin:0 0 14px;transform:skewX(-10deg)}h1 span{color:#ffd21f}
input,button{width:100%;box-sizing:border-box;border:2px solid #111318;border-radius:8px;padding:11px;font-size:15px;margin-top:8px}
button{background:#ffd21f;color:#111318;font:900 14px "Arial Black",Arial,sans-serif;cursor:pointer}.err{color:#ff3b3b;font-weight:700;margin-top:10px}</style></head>
<body><form method="post" action="/admin/login"><h1>BMW <span>ADMIN</span></h1>
${ADMIN_PASSWORD ? '<input type="password" name="pw" placeholder="Passwort" autofocus autocomplete="current-password" required><button>EINLOGGEN</button>' : '<div class="err">Kein Admin-Passwort gesetzt. Das Panel ist nur direkt auf dem Server erreichbar.</div>'}
${msg ? `<div class="err">${msg}</div>` : ''}</form></body></html>`);
}
function handleLogin(req, res) {
  const ip = clientIp(req), now = Date.now();
  const f = loginFails.get(ip);
  if (f && f.until > now) { loginPage(res, 429, `Zu viele Versuche. Warte ${Math.ceil((f.until - now) / 60000)} min.`); return; }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
  req.on('end', () => {
    const pw = new URLSearchParams(body).get('pw') || '';
    if (ADMIN_PASSWORD && safeEq(pw, ADMIN_PASSWORD)) {
      loginFails.delete(ip);
      const https = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.writeHead(303, { Location: '/admin', 'Cache-Control': 'no-store',
        'Set-Cookie': `bmwadmin=${ADMIN_COOKIE}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=2592000${https ? '; Secure' : ''}` });
      res.end();
      console.log(`! Admin-Login von ${ip}`);
      return;
    }
    const n = (f && f.until <= now && f.n >= 5 ? 0 : (f ? f.n : 0)) + 1;
    loginFails.set(ip, { n, until: n >= 5 ? now + 15 * 60000 : 0 });
    console.log(`! Falsches Admin-Passwort von ${ip}`);
    setTimeout(() => loginPage(res, 401, 'Falsches Passwort.'), 800);
  });
}
function handleAdmin(req, res, p) {
  if (p === '/admin/login' && req.method === 'POST') { handleLogin(req, res); return; }
  if (p === '/admin/logout') {
    res.writeHead(303, { Location: '/admin', 'Set-Cookie': 'bmwadmin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0' }); res.end(); return;
  }
  if (!adminAllowed(req)) {
    if (p === '/admin' || p === '/admin/login') { loginPage(res, ADMIN_PASSWORD ? 200 : 403, ''); return; }
    json(res, 401, { error: 'kein Zugriff' }); return;
  }
  if (p === '/admin' || p === '/admin/login') {
    fs.readFile(path.join(ROOT, 'admin.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('admin.html fehlt'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
      res.end(html.replace('__ADMIN_TOKEN__', ADMIN_TOKEN));
    });
    return;
  }
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) { json(res, 401, { error: 'kein Zugriff' }); return; }
  if (p === '/admin/state' && req.method === 'GET') { json(res, 200, adminState()); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'POST erwartet' }); return; }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
  req.on('end', () => {
    let m = {}; try { m = JSON.parse(body || '{}'); } catch (e) { /* */ }
    if (p === '/admin/kick' || p === '/admin/ban') {
      const c = players.get(m.id);
      if (!c) { json(res, 404, { error: 'Spieler nicht gefunden' }); return; }
      const ban = p === '/admin/ban';
      if (ban) banned.set(c.ip, c.name);
      c.send({ t: ban ? 'banned' : 'kicked' });
      console.log(`! ${c.name} (${c.ip}) wurde ${ban ? 'gesperrt' : 'gekickt'}`);
      setTimeout(() => c.close(), 150);
      json(res, 200, { ok: true });
    } else if (p === '/admin/max' || p === '/admin/maxall') {
      const list = p === '/admin/maxall' ? [...players.values()] : [players.get(m.id)].filter(Boolean);
      if (!list.length) { json(res, 404, { error: 'Spieler nicht gefunden' }); return; }
      for (const c of list) { pendingMax.add(maxKey(c)); c.send({ t: 'maxprog' }); console.log(`! ${c.name} (${c.ip}) wird auf Max gesetzt`); }
      json(res, 200, { ok: true, n: list.length });
    } else if (p === '/admin/jumpscare') {
      const c = players.get(m.id);
      if (!c) { json(res, 404, { error: 'Spieler nicht gefunden' }); return; }
      c.send({ t: 'jumpscare' });
      console.log(`! ${c.name} (${c.ip}) bekommt einen Jumpscare`);
      json(res, 200, { ok: true });
    } else if (p === '/admin/flip') {
      const c = players.get(m.id);
      if (!c) { json(res, 404, { error: 'Spieler nicht gefunden' }); return; }
      c.send({ t: 'flip' });
      console.log(`! ${c.name} (${c.ip}) landet auf dem Dach`);
      json(res, 200, { ok: true });
    } else if (p === '/admin/insult') {
      const c = players.get(m.id);
      if (!c) { json(res, 404, { error: 'Spieler nicht gefunden' }); return; }
      c.send({ t: 'insult' });
      console.log(`! ${c.name} (${c.ip}) bekommt den Schwarzbild-Text`);
      json(res, 200, { ok: true });
    } else if (p === '/admin/resetrec') {
      const c = m.id ? players.get(m.id) : [...players.values()].find(x => x.uid && x.uid === m.uid);
      const r = c ? c.rec : recs.recs[m.uid];
      if (!r) { json(res, 404, { error: 'Rekord nicht gefunden' }); return; }
      r.best = 0; r.bestCar = null; r.chal = {}; saveRecs();
      if (c) {
        c.total = 0;
        c.send({ t: 'rec', rec: pubRec(c), reset: true });
        broadcast({ t: 'score', id: c.id, total: 0, drift: 0, best: 0, bestCar: null }, c);
        if (c.cfg) { c.cfg = cleanCfg(c, c.cfg); broadcast({ t: 'cfg', id: c.id, cfg: c.cfg }, c); }
      }
      console.log(`! Rekorde von ${r.name || m.uid} zurückgesetzt`);
      json(res, 200, { ok: true });
    } else if (p === '/admin/unban') {
      banned.delete(m.ip);
      console.log(`! Sperre für ${m.ip} aufgehoben`);
      json(res, 200, { ok: true });
    } else json(res, 404, { error: 'unbekannt' });
  });
}

// ---------- Minimaler WebSocket (RFC 6455) ----------
function encodeFrame(str, opcode) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | (opcode || 1);
  return Buffer.concat([head, payload]);
}

class Client {
  constructor(socket, req) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.id = null; this.slot = -1;
    this.name = 'Spieler'; this.cfg = null; this.alive = true;
    this.ip = clientIp(req); this.local = isLocal(req); this.since = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  send(obj) { if (this.alive) { try { this.socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { this.close(); } } }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { try { this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch (e) { /* */ } continue; }
      if (opcode === 1) { let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { continue; } onMessage(this, msg); }
    }
  }
  close() {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.destroy(); } catch (e) { /* */ }
    if (this.id) {
      players.delete(this.id);
      broadcast({ t: 'leave', id: this.id }, null);
      console.log(`- ${this.name} hat das Spiel verlassen (${players.size}/${MAX_PLAYERS})`);
    }
  }
}

const players = new Map();
let nextId = 1;
const cleanCar = (s) => (typeof s === 'string' && /^[a-z0-9_]{1,24}$/.test(s)) ? s : null;   // Fahrzeug-ID des Rekords

// ---------- Rekorde: liegen auf dem Server, nicht im Browser ----------
// Der Browser kann nichts mehr selbst eintragen: Jeder Drift wird gegen das geprüft, was laut den
// Positionsdaten des Autos (Tempo, Driftwinkel, Dauer) überhaupt möglich war. Über die Konsole
// gefälschte Punkte werden verworfen, und der Browser bekommt den echten Stand zurück.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const REC_FILE = path.join(DATA_DIR, 'records.json');
// Alte Rekorde aus dem Browser werden einmalig übernommen (nur bis zu dieser Grenze, nur in den ersten 14 Tagen)
const LEGACY_CAP = parseInt(process.env.LEGACY_CAP, 10) || 1000000;
const cleanUid = (s) => (typeof s === 'string' && /^[a-f0-9]{32}$/.test(s)) ? s : null;
let recs = { legacyUntil: Date.now() + 14 * 86400e3, recs: {} };
try { const f = JSON.parse(fs.readFileSync(REC_FILE, 'utf8')); if (f && f.recs) recs = f; } catch (e) { /* noch keine Datei */ }
let recSaveT = null;
function saveRecs() {
  if (recSaveT) return;
  recSaveT = setTimeout(() => {
    recSaveT = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(REC_FILE + '.tmp', JSON.stringify(recs)); fs.renameSync(REC_FILE + '.tmp', REC_FILE); }
    catch (e) { console.log('! Rekorde konnten nicht gespeichert werden:', e.message); }
  }, 1500);
}
function pubRec(c) {
  const chal = {};
  for (const [k, v] of Object.entries(c.rec.chal || {})) chal[k] = { pts: v.pts, car: v.car || null };
  return { best: c.rec.best, bestCar: c.rec.bestCar || null, chal };
}
function recordFor(c, m) {
  let r = c.uid && recs.recs[c.uid];
  if (!r) {
    r = { name: c.name, best: 0, bestCar: null, chal: {} };
    if (Date.now() < recs.legacyUntil) {                         // Umstieg: alten Rekord aus dem Browser übernehmen
      const b = Math.round(+m.best || 0);
      if (b > LEGACY_CAP) console.log(`! ${c.name} (${c.ip}): Rekord ${b} aus dem Browser verworfen (zu hoch)`);
      else if (b > 0) { r.best = b; r.bestCar = cleanCar(m.bestCar); }
      const cr = (m.cfg && typeof m.cfg.chalRec === 'object' && m.cfg.chalRec) || {}, cc = (m.cfg && m.cfg.chalRecCar) || {};
      for (const k in cr) { const v = Math.round(+cr[k] || 0); if (cleanCar(k) && v > 0 && v <= LEGACY_CAP) r.chal[k] = { pts: v, car: cleanCar(cc[k]) }; }
    }
    if (c.uid) { recs.recs[c.uid] = r; saveRecs(); }
  }
  r.name = c.name; r.seen = Date.now();
  return r;
}
// Was andere über diesen Spieler sehen: Rekordwerte kommen vom Server, nicht aus dem Browser
function cleanCfg(c, cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  cfg = Object.assign({}, cfg);
  const chal = {}, chalCar = {};
  for (const [k, v] of Object.entries(c.rec.chal || {})) { chal[k] = v.pts; if (v.car) chalCar[k] = v.car; }
  cfg.chalRec = chal; cfg.chalRecCar = chalCar; cfg.bestCar = c.rec.bestCar || null;
  cfg.lvl = Math.max(1, Math.min(50, Math.round(+cfg.lvl || 1)));
  return cfg;
}
// Neue Challenge-Rekorde: höchstens so viel, wie der Spieler in dieser Runde geprüft erdriftet hat
function takeChal(c, cfg) {
  const cr = cfg && typeof cfg.chalRec === 'object' && cfg.chalRec; if (!cr) return;
  for (const k in cr) {
    const v = Math.round(+cr[k] || 0), old = c.rec.chal[k];
    if (!cleanCar(k) || v <= (old ? old.pts : 0)) continue;
    if (v <= (c.total || 0) + 200) { c.rec.chal[k] = { pts: v, car: cleanCar((cfg.chalRecCar || {})[k]) }; saveRecs(); }
    else { console.log(`! ${c.name} (${c.ip}): Challenge-Rekord ${v} auf ${k} verworfen (geprüft: ${c.total || 0})`); c.cheatFlag = true; }
  }
}
// Drift-Budget: wie viele Punkte wären laut den 20 Positionsmeldungen pro Sekunde maximal drin gewesen?
// Gleiche Formel wie im Spiel (main.js updateScore), immer mit Mauer-Bonus x2 und dem höchsten Multiplikator.
function trackDrift(c, m, now) {
  const gap = c.lastS ? Math.min(0.3, (now - c.lastS) / 1000) : 0; c.lastS = now;
  const vx = +m.vx || 0, vz = +m.vz || 0, u = +m.u || 0;
  const sp = Math.min(120, Math.hypot(vx, vz));
  if (!isFinite(sp) || !isFinite(u)) return;
  c.pos = { x: +m.x || 0, z: +m.z || 0, sp, u, at: now };
  const ang = sp > 3 ? Math.atan2(Math.sqrt(Math.max(0, sp * sp - u * u)), Math.abs(u)) * 180 / Math.PI : 0;
  if (sp > 6 && ang > 8 && u > 0) {
    c.dT = (c.dT || 0) + gap; c.idle = 0;
    const mult = tandemNear(c) ? 10 : Math.min(5, 1 + Math.floor(c.dT / 1.5) * 0.5);
    c.budget = (c.budget || 0) + gap * Math.min(ang, 75) * sp * 3.6 * 0.06 * mult * 2;
  } else {
    c.idle = (c.idle || 0) + gap;
    if (c.idle > 1.6) c.dT = 0;
    if (c.idle > 8) c.budget = 0;                                // Drift ist längst gewertet oder verfallen
  }
}
function tandemNear(c) {
  const map = (c.cfg && c.cfg.map) || 'hakone';
  for (const o of players.values()) {
    if (o === c || !o.pos || c.pos.at - o.pos.at > 1000 || ((o.cfg && o.cfg.map) || 'hakone') !== map || o.pos.sp < 6) continue;
    if (Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 18) return true;
  }
  return false;
}
// Drift-Punkte einlösen. Chat-Meldung und Punktestand kommen für denselben Drift kurz nacheinander → nur einmal abbuchen.
function claim(c, pts) {
  const now = Date.now();
  if (c.claimed === pts && now - c.claimedAt < 3000) { c.claimed = 0; return true; }
  const extra = now - (c.flatAt || 0) > 20000 ? 6000 : 500;     // Raucher-Bonus (+5.000) höchstens alle 20 s
  const lim = (c.budget || 0) * 1.3 + extra;
  if (pts > lim) {
    if (!c.warnAt || now - c.warnAt > 5000) { c.warnAt = now; console.log(`! ${c.name} (${c.ip}): Drift ${pts} verworfen (möglich: ${Math.round(lim)})`); }
    return false;
  }
  if (pts > (c.budget || 0) * 1.3 + 500) c.flatAt = now;
  c.budget = Math.max(0, (c.budget || 0) - pts); c.claimed = pts; c.claimedAt = now;
  return true;
}
function resync(c) { if (!c.syncAt || Date.now() - c.syncAt > 1000) { c.syncAt = Date.now(); c.send({ t: 'rec', rec: pubRec(c) }); } }
const clean = (s) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Spieler';

// ---------- Chat ----------
// kind: 'msg' (getippt), 'drift' (Drift geschafft, pts), 'crash' (Drift vermasselt, pts verloren)
const chatLog = [];                                            // letzte Nachrichten für neue Spieler
function chatPost(c, entry) {
  const m = Object.assign({ t: 'chat', id: c.id, name: c.name, slot: c.slot, at: Date.now() }, entry);
  chatLog.push(m); if (chatLog.length > 30) chatLog.shift();
  broadcast(m, null);                                          // auch an den Absender (als Bestätigung)
}
function onChat(c, m) {
  const now = Date.now();
  if (m.kind === 'drift' || m.kind === 'crash' || m.kind === 'police') {
    let pts = Math.max(0, Math.min(1e7, Math.round(+m.pts || 0)));
    if (m.kind === 'police') pts = Math.min(pts, 1);
    if (m.kind === 'drift' && pts && !claim(c, pts)) { resync(c); return; }
    if (m.kind === 'crash' && pts > (c.budget || 0) * 1.3 + 12000) return;   // verlorene Punkte: nicht mehr als möglich
    if (!pts || now - (c.lastEv || 0) < 250) return;
    c.lastEv = now;
    chatPost(c, { kind: m.kind, pts });
  } else {
    const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!text) return;
    if (now - (c.lastChat || 0) < 600) return;                   // gegen Spam: max. ~2 Nachrichten pro Sekunde
    c.lastChat = now;
    chatPost(c, { kind: 'msg', text });
    console.log(`  [Chat] ${c.name}: ${text}`);
  }
}

function broadcast(obj, except) {
  const frame = encodeFrame(JSON.stringify(obj));
  for (const c of players.values()) if (c !== except && c.alive) { try { c.socket.write(frame); } catch (e) { c.close(); } }
}

function onMessage(c, m) {
  if (m.t === 'hello') {
    if (c.id) return;
    if (banned.has(c.ip)) { c.send({ t: 'banned' }); setTimeout(() => c.close(), 200); console.log(`x Gesperrter Spieler (${c.ip}) wurde abgewiesen`); return; }
    if (players.size >= MAX_PLAYERS) { c.send({ t: 'full', max: MAX_PLAYERS }); setTimeout(() => c.close(), 200); return; }
    const used = new Set([...players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    c.id = 'p' + (nextId++); c.slot = slot; c.name = clean(m.name); c.uid = cleanUid(m.uid);
    c.rec = recordFor(c, m); c.cfg = cleanCfg(c, m.cfg);
    players.set(c.id, c);
    c.send({ t: 'welcome', id: c.id, slot, max: MAX_PLAYERS, version: VERSION, urls: lanUrls(), rec: pubRec(c), players: [...players.values()].filter(p => p !== c).map(p => ({ id: p.id, slot: p.slot, name: p.name, cfg: p.cfg, total: p.total || 0, best: p.rec.best, bestCar: p.rec.bestCar || null })), chat: chatLog.slice(-15) });
    broadcast({ t: 'join', id: c.id, slot, name: c.name, cfg: c.cfg, best: c.rec.best, bestCar: c.rec.bestCar || null }, c);
    console.log(`+ ${c.name} ist beigetreten (${players.size}/${MAX_PLAYERS})`);
    if (pendingMax.has(maxKey(c))) c.send({ t: 'maxprog' });   // altes Spiel hatte den Befehl verpasst
    return;
  }
  if (!c.id) return;
  if (m.t === 's') { trackDrift(c, m, Date.now()); m.id = c.id; broadcast(m, c); }
  else if (m.t === 'cfg') {
    c.cheatFlag = false; takeChal(c, m.cfg);
    const cfg = cleanCfg(c, m.cfg); if (!cfg) return;
    c.cfg = cfg; broadcast({ t: 'cfg', id: c.id, cfg }, c);
    const sent = (m.cfg.chalRec && typeof m.cfg.chalRec === 'object') ? m.cfg.chalRec : {};
    if (c.cheatFlag || Object.keys(sent).some(k => Math.round(+sent[k] || 0) !== cfg.chalRec[k]) || Object.keys(cfg.chalRec).some(k => !(k in sent))) resync(c);
  }
  else if (m.t === 'name') { c.name = clean(m.name); c.rec.name = c.name; broadcast({ t: 'name', id: c.id, name: c.name }, c); }
  else if (m.t === 'score') {
    const drift = Math.max(0, Math.min(1e7, Math.round(+m.drift || 0)));
    let ok = 0;
    if (drift > 0) { if (claim(c, drift)) ok = drift; else resync(c); }
    const total = Math.max(-1e7, Math.round(+m.total || 0));
    c.total = Math.min(total, (c.total || 0) + ok);              // Gesamtpunkte: nur geprüfte Drifts zählen dazu
    if (ok > c.rec.best) { c.rec.best = ok; c.rec.bestCar = cleanCar(m.bestCar) || cleanCar(c.cfg && c.cfg.model); saveRecs(); }
    broadcast({ t: 'score', id: c.id, total: c.total, drift: ok, best: c.rec.best, bestCar: c.rec.bestCar || null }, c);
  }
  else if (m.t === 'maxok') { if (pendingMax.delete(maxKey(c))) console.log(`! ${c.name} ist jetzt auf Max`); }
  else if (m.t === 'away') { broadcast({ t: 'away', id: c.id }, c); }
  else if (m.t === 'chat') onChat(c, m);
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  new Client(socket, req);
});

server.listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls();
  console.log('\n  ==============================================');
  console.log('   E46 DRIFT – Multiplayer-Server läuft');
  console.log('  ==============================================');
  console.log(`   Du selbst:        http://localhost:${PORT}`);
  for (const u of urls) console.log(u === process.env.PUBLIC_URL ? `   Freunde ONLINE:   ${u}` : `   Freunde im WLAN:  ${u}`);
  console.log(`   Adminpanel:       http://localhost:${PORT}/admin   ${ADMIN_PASSWORD ? '(auch über den öffentlichen Link + /admin, mit Passwort)' : '(nur auf diesem Rechner – ADMIN_PASSWORD setzen für Zugriff von außen)'}`);
  console.log(`   Max. ${MAX_PLAYERS} Spieler · Beenden mit Ctrl+C\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) require('child_process').exec(`open http://localhost:${PORT}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log(`Port ${PORT} ist schon belegt – läuft der Server schon? Sonst: PORT=8047 node server.js`);
  else console.log(e);
  process.exit(1);
});
