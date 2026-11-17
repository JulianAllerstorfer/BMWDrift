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
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');   // nur für das Adminpanel auf diesem Mac
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
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
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
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('.') || ['admin.html', 'server.js'].includes(path.basename(file))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
  if (p === '/index.html') console.log(`  Seite aufgerufen von ${req.socket.remoteAddress}`);
});

// ---------- Adminpanel (nur vom Host-Mac aus erreichbar) ----------
function adminState() {
  return {
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, ip: p.ip, slot: p.slot, total: p.total || 0, host: p.local, since: p.since, maxPending: pendingMax.has(maxKey(p)) })),
    banned: [...banned.entries()].map(([ip, name]) => ({ ip, name })),
    max: MAX_PLAYERS, urls: lanUrls()
  };
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function handleAdmin(req, res, p) {
  if (!isLocal(req)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Das Adminpanel ist nur auf dem Host-Mac erreichbar.'); return; }
  if (p === '/admin') {
    fs.readFile(path.join(ROOT, 'admin.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(500); res.end('admin.html fehlt'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
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
    const pts = Math.max(0, Math.min(1e7, Math.round(+m.pts || 0)));
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
    c.id = 'p' + (nextId++); c.slot = slot; c.name = clean(m.name); c.cfg = m.cfg || null; c.best = Math.max(0, +m.best || 0); c.bestCar = cleanCar(m.bestCar);
    players.set(c.id, c);
    c.send({ t: 'welcome', id: c.id, slot, max: MAX_PLAYERS, version: VERSION, urls: lanUrls(), players: [...players.values()].filter(p => p !== c).map(p => ({ id: p.id, slot: p.slot, name: p.name, cfg: p.cfg, total: p.total || 0, best: p.best || 0, bestCar: p.bestCar || null })), chat: chatLog.slice(-15) });
    broadcast({ t: 'join', id: c.id, slot, name: c.name, cfg: c.cfg, best: c.best, bestCar: c.bestCar }, c);
    console.log(`+ ${c.name} ist beigetreten (${players.size}/${MAX_PLAYERS})`);
    if (pendingMax.has(maxKey(c))) c.send({ t: 'maxprog' });   // altes Spiel hatte den Befehl verpasst
    return;
  }
  if (!c.id) return;
  if (m.t === 's') { m.id = c.id; broadcast(m, c); }
  else if (m.t === 'cfg') { c.cfg = m.cfg; broadcast({ t: 'cfg', id: c.id, cfg: m.cfg }, c); }
  else if (m.t === 'name') { c.name = clean(m.name); broadcast({ t: 'name', id: c.id, name: c.name }, c); }
  else if (m.t === 'score') { c.total = +m.total || 0; if ((+m.best || 0) >= (c.best || 0) && cleanCar(m.bestCar)) c.bestCar = cleanCar(m.bestCar); c.best = Math.max(c.best || 0, +m.best || 0); broadcast({ t: 'score', id: c.id, total: c.total, drift: +m.drift || 0, best: c.best, bestCar: c.bestCar || null }, c); }
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
  console.log(`   Adminpanel:       http://localhost:${PORT}/admin   (nur auf diesem Mac)`);
  console.log(`   Max. ${MAX_PLAYERS} Spieler · Beenden mit Ctrl+C\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) require('child_process').exec(`open http://localhost:${PORT}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log(`Port ${PORT} ist schon belegt – läuft der Server schon? Sonst: PORT=8047 node server.js`);
  else console.log(e);
  process.exit(1);
});
