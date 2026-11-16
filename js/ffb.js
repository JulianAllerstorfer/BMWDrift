/* =====================================================================
   Force Feedback für Logitech-Lenkräder über WebHID (Chrome / Edge)
   Die Gamepad-API im Browser kann bei Lenkrädern keine Kräfte ausgeben, darum
   wird das Lenkrad zusätzlich per WebHID geöffnet und mit dem klassischen
   Logitech-Protokoll angesteuert (wie der Linux-Treiber hid-lg4ff):
   G25, G27, G29, G923 (PlayStation-Version), Driving Force GT / Pro / EX.
   G920 und G923 (Xbox-Version) sprechen ein anderes Protokoll (HID++) und
   werden hier nicht unterstützt.
   Kraft: -1 … 1, positiv = Lenkrad zieht nach RECHTS.
   ===================================================================== */
(function () {
  'use strict';

  const VENDOR = 0x046d;
  // Produkt-IDs mit klassischem FFB-Protokoll
  const CLASSIC = { 0xc294: 'Driving Force / EX', 0xc298: 'Driving Force Pro', 0xc299: 'G25', 0xc29a: 'Driving Force GT', 0xc29b: 'G27',
    0xc24f: 'G29', 0xc260: 'G29', 0xc266: 'G923', 0xc267: 'G923', 0xca03: 'MOMO', 0xca04: 'Formula Vibration' };
  const HIDPP = { 0xc261: 'G920', 0xc262: 'G920', 0xc26d: 'G923 (Xbox)', 0xc26e: 'G923 (Xbox)' };

  const st = { dev: null, name: '', busy: false, lastByte: -1, lastSend: 0, error: '', unsupported: '', outId: 0, outLen: 7, sent: 0, failed: 0 };
  const supported = () => typeof navigator !== 'undefined' && !!navigator.hid && window.isSecureContext;

  // Output-Report (ID und Länge) aus der Gerätebeschreibung lesen statt fest 0 / 7 Bytes anzunehmen –
  // passt die Länge nicht genau, lehnt der Browser jeden Befehl ab und das Lenkrad bleibt stumm.
  function findOut(dev) {
    const walk = (cols) => {
      for (const c of cols || []) {
        for (const r of c.outputReports || []) {
          const bits = (r.items || []).reduce((a, it) => a + (it.reportSize || 0) * (it.reportCount || 0), 0);
          if (bits >= 56) return { id: r.reportId || 0, len: Math.ceil(bits / 8), found: true };
        }
        const sub = walk(c.children); if (sub) return sub;
      }
      return null;
    };
    return walk(dev.collections) || { id: 0, len: 7, found: false };
  }
  function cmd(bytes) {
    if (!st.dev || !st.dev.opened) return Promise.resolve();
    const d = new Uint8Array(Math.max(7, st.outLen)); d.set(bytes);
    return st.dev.sendReport(st.outId, d)
      .then(() => { st.sent++; st.error = ''; })
      .catch((e) => { st.failed++; st.error = String(e && e.message || e); console.warn('[FFB]', st.error); });
  }
  async function init(dev) {
    if (!dev.opened) await dev.open();
    const out = findOut(dev);
    st.dev = dev; st.name = CLASSIC[dev.productId] || dev.productName || 'Logitech'; st.lastByte = -1; st.error = '';
    st.outId = out.id; st.outLen = out.len; st.sent = 0; st.failed = 0;
    console.info('[FFB]', st.name, 'PID', dev.productId.toString(16), 'Report-ID', st.outId, 'Länge', st.outLen);
    await cmd([0xf5]);   // eingebaute Rückstellfeder aus, die Kräfte kommen jetzt vom Spiel
    await cmd([0x13]);   // Kraft in Slot 1 stoppen
  }
  async function tryOpen(devs) {
    st.unsupported = '';
    // Windows teilt das Lenkrad in mehrere HID-Schnittstellen auf – die mit Output-Report zuerst probieren,
    // sonst landen die Befehle bei einer Schnittstelle, die sie ablehnt („Invalid output report ID“)
    const hasOut = (d) => { const o = findOut(d); return o.found ? 1 : 0; };
    devs = [...devs].sort((a, b) => hasOut(b) - hasOut(a));
    for (const d of devs) {
      if (d.vendorId !== VENDOR) continue;
      if (HIDPP[d.productId]) { st.unsupported = HIDPP[d.productId]; continue; }
      if (!CLASSIC[d.productId]) continue;
      try { await init(d); return true; } catch (e) { st.error = String(e && e.message || e); }
    }
    return false;
  }
  // Muss aus einem Klick heraus aufgerufen werden (Browser fragt einmal nach Erlaubnis)
  async function connect() {
    if (!supported()) { st.error = 'Dein Browser kann das nicht (nur Chrome/Edge, über localhost oder https).'; return false; }
    try {
      const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR }] });
      const ok = await tryOpen(devs);
      if (!ok && !st.unsupported && devs.length) st.error = 'Dieses Lenkrad wird nicht unterstützt.';
      return ok;
    } catch (e) { st.error = String(e && e.message || e); return false; }
  }
  // Schon erlaubte Lenkräder beim Start (und beim Einstecken) automatisch öffnen
  if (supported()) {
    navigator.hid.getDevices().then(tryOpen).catch(() => {});
    navigator.hid.addEventListener('connect', (e) => { if (!st.dev) tryOpen([e.device]); });
    navigator.hid.addEventListener('disconnect', (e) => { if (e.device === st.dev) { st.dev = null; st.name = ''; } });
  }

  // Konstante Kraft setzen (nur senden, wenn sich etwas ändert, und nie mehrere Befehle gleichzeitig)
  function set(f) {
    if (!st.dev || st.busy) return;
    f = Math.max(-1, Math.min(1, f || 0));
    const b = Math.max(0, Math.min(255, Math.round(0x80 - f * 127)));   // 0x80 = keine Kraft, kleiner = nach rechts
    const now = performance.now();
    if (b === st.lastByte && now - st.lastSend < 500) return;
    st.lastByte = b; st.lastSend = now; st.busy = true;
    const p = b === 0x80 ? cmd([0x13]) : cmd([0x11, 0x08, b, 0x80]);
    p.finally(() => { st.busy = false; });
  }
  function stop() { if (st.dev && st.lastByte !== 0x80) { st.lastByte = 0x80; st.busy = false; cmd([0x13]); } }
  window.addEventListener('pagehide', stop);

  window.FFB = {
    supported, connect, set, stop,
    get connected() { return !!(st.dev && st.dev.opened); },
    get name() { return st.name; },
    get error() { return st.error; },
    get unsupported() { return st.unsupported; },
    // Kurzinfo für die Statuszeile im SETUP (hilft bei der Fehlersuche)
    get diag() { return st.dev ? 'PID ' + st.dev.productId.toString(16) + ' · Report ' + st.outId + '/' + st.outLen + ' B · gesendet ' + st.sent + (st.failed ? ' · fehlgeschlagen ' + st.failed : '') : ''; }
  };
})();
