/* =====================================================================
   Nachbearbeitung des Bildes: Leuchten (Bloom) um helle Lichter,
   dunklere Bildecken (Vignette) und etwas mehr Farbe/Kontrast.
   Das Bild wird erst in eine Textur gerendert (mit Kantenglättung),
   helle Stellen werden verkleinert weichgezeichnet und wieder addiert.
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  function create(renderer) {
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null); quad.frustumCulled = false;
    const scene = new T.Scene(); scene.add(quad);
    const opt = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    const main = new T.WebGLRenderTarget(4, 4, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    const a1 = new T.WebGLRenderTarget(4, 4, opt), b1 = new T.WebGLRenderTarget(4, 4, opt);
    const a2 = new T.WebGLRenderTarget(4, 4, opt), b2 = new T.WebGLRenderTarget(4, 4, opt);

    // helle Stellen herausziehen
    const bright = new T.ShaderMaterial({
      uniforms: { tex: { value: null }, thr: { value: 0.8 } }, vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex; uniform float thr; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tex, vUv).rgb; float m = max(c.r, max(c.g, c.b));
          float k = smoothstep(thr, thr + 0.18, m); gl_FragColor = vec4(c * k, 1.0); }`
    });
    // Weichzeichner in eine Richtung
    const blur = new T.ShaderMaterial({
      uniforms: { tex: { value: null }, dir: { value: new T.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tex, vUv).rgb * 0.227027;
          c += (texture2D(tex, vUv + dir * 1.3846).rgb + texture2D(tex, vUv - dir * 1.3846).rgb) * 0.316216;
          c += (texture2D(tex, vUv + dir * 3.2308).rgb + texture2D(tex, vUv - dir * 3.2308).rgb) * 0.070270;
          gl_FragColor = vec4(c, 1.0); }`
    });
    const mix = new T.ShaderMaterial({
      uniforms: { tex: { value: null }, b1: { value: null }, b2: { value: null }, bloom: { value: 0.4 }, vig: { value: 0.32 }, sat: { value: 1.08 }, con: { value: 1.04 }, aspect: { value: 1 } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex; uniform sampler2D b1; uniform sampler2D b2; uniform float bloom; uniform float vig; uniform float sat; uniform float con; uniform float aspect; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tex, vUv).rgb;
          vec3 b = texture2D(b1, vUv).rgb * 0.55 + texture2D(b2, vUv).rgb * 0.75;
          c += b * bloom;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, sat);
          c = (c - 0.5) * con + 0.5;
          vec2 q = (vUv - 0.5) * vec2(1.0, 1.0 / max(aspect, 1.0) * 1.25);
          c *= 1.0 - vig * smoothstep(0.32, 0.86, length(q));
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`
    });
    function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(scene, cam); }
    const size = new T.Vector2();
    let w = 0, h = 0;
    function resize() {
      renderer.getDrawingBufferSize(size);
      if (size.x === w && size.y === h) return;
      w = size.x; h = size.y;
      main.setSize(w, h);
      const w1 = Math.max(2, w >> 2), h1 = Math.max(2, h >> 2), w2 = Math.max(2, w >> 3), h2 = Math.max(2, h >> 3);
      a1.setSize(w1, h1); b1.setSize(w1, h1); a2.setSize(w2, h2); b2.setSize(w2, h2);
      mix.uniforms.aspect.value = w / h;
    }
    const api = {
      enabled: true, bloom: 0.4, threshold: 0.8,
      resize,
      render(sc, camera) {
        resize();
        renderer.setRenderTarget(main); renderer.render(sc, camera);
        const auto = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
        const u = mix.uniforms;
        if (!api.enabled) {
          // Effekte aus: Bild nur (geglättet) auf den Bildschirm kopieren
          u.tex.value = main.texture; u.b1.value = main.texture; u.b2.value = main.texture; u.bloom.value = 0; u.vig.value = 0; u.sat.value = 1; u.con.value = 1;
          pass(mix, null); renderer.shadowMap.autoUpdate = auto; return;
        }
        u.vig.value = 0.32; u.sat.value = 1.08; u.con.value = 1.04;
        bright.uniforms.tex.value = main.texture; bright.uniforms.thr.value = api.threshold; pass(bright, a1);
        blur.uniforms.tex.value = a1.texture; blur.uniforms.dir.value.set(1 / a1.width, 0); pass(blur, b1);
        blur.uniforms.tex.value = b1.texture; blur.uniforms.dir.value.set(0, 1 / a1.height); pass(blur, a1);
        blur.uniforms.tex.value = a1.texture; blur.uniforms.dir.value.set(1.6 / a2.width, 0); pass(blur, b2);
        blur.uniforms.tex.value = b2.texture; blur.uniforms.dir.value.set(0, 1.6 / a2.height); pass(blur, a2);
        mix.uniforms.tex.value = main.texture; mix.uniforms.b1.value = a1.texture; mix.uniforms.b2.value = a2.texture; mix.uniforms.bloom.value = api.bloom;
        pass(mix, null);
        renderer.shadowMap.autoUpdate = auto;
      }
    };
    return api;
  }
  window.Post = { create };
})();
