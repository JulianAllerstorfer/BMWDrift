// Jonny im Rollstuhl schreit alle ~10 s eine dumme Bemerkung: Sprechblase über dem Kopf + Sprachausgabe
(function () {
  const T = THREE;
  const LINES = [
    'Du Trottl!', 'Oida, fahr gscheit!', 'Geh schleich di!', 'Du Hirnederl!', 'Bist deppert?!',
    'Schau, dass d\' weiterkommst!', 'Hupf in Gatsch!', 'Du Wappla!', 'Heast, du Koffer!',
    'Wer hat dir den Führerschein gschenkt?', 'Mei Rollstuhl hat mehr PS als dei Hirn!', 'Du Dodl!',
    'Wos schaust so deppat?', 'Du Nudlaug!', 'Kannst ned fahren oder wos?', 'Seawas, ihr Lutscher!',
    'I bin der Kini vom Asphalt!', 'Brems ned, du Waschlappen!', 'Zipfer her, aber zackig!',
    'Driften kann i im Schlaf!', 'Gemma, gemma, Gas geben!', 'Du Gschissener!', 'Ois Trottln do!',
    'Mei Oma fahrt schneller!', 'Aus da Bahn, du Eierschädl!', 'Heast, du Pfeifn!', 'Bled bist ah no!',
    'Schmeiß di über d\'Häuser!', 'I bin schneller wia dei Mama!', 'Gib Gas, du Schnecke!',
    'DIGIDIGI DIGI DIGI DIGI DIGI!!!'
  ];
  let voice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /^de[-_]AT/i.test(v.lang)) || vs.find(v => /^de[-_]DE/i.test(v.lang) && /male|mann|markus|yannick|viktor|martin|hans/i.test(v.name)) || vs.find(v => /^de/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  // „Digi digi“ wird geschrien: gleicher Text wie früher (damit es nach dem Original klingt),
  // aber volle Lautstärke, höhere Stimme und etwas schneller
  const DIGI_SAY = 'Digidigi digi digi digi digi!';
  function speak(text, vol) {
    if (!window.speechSynthesis || vol <= 0.01) return;
    const digi = text === LINES[LINES.length - 1];
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(digi ? DIGI_SAY : text);
      u.lang = voice ? voice.lang : 'de-AT'; if (voice) u.voice = voice;
      if (digi) {
        u.rate = 1.3; u.pitch = 1.7; u.volume = Math.min(1, vol * 1.5);   // lauter als 100 % geht die Browserstimme nicht …
        // … deshalb wird das restliche Spiel leise, solange er schreit (dann wirkt er viel lauter).
        // Wie stark, hängt von der Lautstärke ab: eigener Jonny fast stumm, ferne Mitspieler kaum.
        const S = window.Sound, duck = (k) => { if (S && S.setDuck) S.setDuck(k); };
        let undo = null;
        const restore = () => { clearTimeout(undo); duck(1); };
        const k = 1 - 0.88 * Math.min(1, vol);
        u.onstart = () => { duck(k); undo = setTimeout(restore, 4000); };   // Sicherheitsnetz, falls onend ausbleibt
        u.onend = u.onerror = restore;
      }
      else { u.rate = 1.12; u.pitch = 1.25; u.volume = Math.max(0, Math.min(1, vol)); }
      speechSynthesis.speak(u);
    } catch (e) { /* keine Sprachausgabe */ }
  }

  // Sprechblase als Sprite (für die anderen Spieler über dem Rollstuhl)
  function bubbleTexture(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const g = c.getContext('2d');
    g.font = '900 40px Arial Black, Arial, sans-serif';
    let fs = 40; while (g.measureText(text).width > 450 && fs > 22) { fs -= 2; g.font = `900 ${fs}px Arial Black, Arial, sans-serif`; }
    const w = Math.min(490, g.measureText(text).width + 44), x0 = (512 - w) / 2;
    g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 6;
    g.beginPath(); g.roundRect ? g.roundRect(x0, 8, w, 104, 26) : g.rect(x0, 8, w, 104);
    g.moveTo(236, 110); g.lineTo(256, 150); g.lineTo(282, 110);
    g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(238, 104, 42, 10);
    g.fillStyle = '#d3131b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 61);
    const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
  }
  function showBubble(root, text, y) {
    if (root.userData.bubble) { const b = root.userData.bubble; root.remove(b); b.material.map.dispose(); b.material.dispose(); }
    const sp = new T.Sprite(new T.SpriteMaterial({ map: bubbleTexture(text), depthTest: false, depthWrite: false }));
    sp.scale.set(2.4, 0.75, 1); sp.position.y = y || 1.95; sp.renderOrder = 9;
    root.add(sp); root.userData.bubble = sp; root.userData.bubbleT = 3.2;
  }
  function tickBubble(root, dt) {
    const b = root.userData.bubble; if (!b) return;
    root.userData.bubbleT -= dt;
    b.material.opacity = Math.min(1, root.userData.bubbleT / 0.4);
    if (root.userData.bubbleT <= 0) { root.remove(b); b.material.map.dispose(); b.material.dispose(); root.userData.bubble = null; }
  }

  let last = -1;
  const DIGI = LINES.length - 1;   // „Digidigi …“ kommt viel öfter (≈ 40 %)
  function pick() { if (Math.random() < 0.4) { last = DIGI; return DIGI; } let i; do { i = (Math.random() * LINES.length) | 0; } while ((i === last || i === DIGI) && LINES.length > 2); last = i; return i; }

  window.Jonny = { DIGI, LINES, speak, showBubble, tickBubble, pick, nextDelay: () => 9 + Math.random() * 2.5 };
})();
