/* =====================================================================
   Effekte: Reifenqualm, Bremsspuren, Fehlzündungs-Flammen
   ===================================================================== */
(function () {
  'use strict';
  const T = THREE;

  // ---------- Qualm (Partikel als Punkte mit eigener Shader-Größe) ----------
  class Smoke {
    constructor(scene, max) {
      this.max = max || 900;
      this.pos = new Float32Array(this.max * 3);
      this.vel = new Float32Array(this.max * 3);
      this.life = new Float32Array(this.max);
      this.maxLife = new Float32Array(this.max);
      this.size = new Float32Array(this.max);
      this.alpha = new Float32Array(this.max);
      this.shade = new Float32Array(this.max * 3);
      this.head = 0;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('size', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
      g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
      g.setAttribute('shade', new T.BufferAttribute(this.shade, 3).setUsage(T.DynamicDrawUsage));
      this.mat = new T.ShaderMaterial({
        uniforms: { scale: { value: 600 }, tint: { value: new T.Color(0xffffff) } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 shade; uniform float scale;
          varying float vA; varying vec3 vS; varying float vRot;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
            float dz = -mv.z;
            // Qualm direkt vor der Kamera (Auto neben dir driftet): ausblenden und Größe begrenzen –
            // bildschirmfüllende durchsichtige Punkte kosten auf schwächeren Grafikchips sehr viel Leistung
            gl_PointSize = min(size * scale / dz, 320.0); vA = alpha * smoothstep(1.2, 4.5, dz); vS = shade; vRot = position.x * 3.1 + position.z * 1.7; }`,
        fragmentShader: `uniform vec3 tint; varying float vA; varying vec3 vS; varying float vRot;
          void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot); p = mat2(c,-s,s,c) * p;
            float r = length(p) * 2.0;
            float lobes = 0.86 + 0.14 * sin(atan(p.y, p.x) * 5.0);
            float a = 1.0 - smoothstep(lobes - 0.12, lobes, r);
            if (a < 0.01) discard;
            float light = mix(0.86, 1.0, smoothstep(0.2, -0.35, p.y));
            light = r > lobes - 0.25 ? light * 0.95 : light;
            gl_FragColor = vec4(vS * light * tint, a * vA); }`,
        transparent: true, depthWrite: false
      });
      this.points = new T.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.geo = g;
      scene.add(this.points);
    }
    emit(x, y, z, vx, vy, vz, size, life, shade) {
      if (this.enabled === false) return;
      const i = this.head; this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
      if (Array.isArray(shade)) { this.shade[i * 3] = shade[0]; this.shade[i * 3 + 1] = shade[1]; this.shade[i * 3 + 2] = shade[2]; }
      else { const v = shade || 0.97; this.shade[i * 3] = this.shade[i * 3 + 1] = this.shade[i * 3 + 2] = v; }
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
        this.life[i] -= dt;
        const k = 1 - this.life[i] / this.maxLife[i];
        const drag = Math.exp(-dt * 2.2);
        this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * 0.9;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.size[i] += dt * (3.2 * (1 - k) + 0.6);
        this.alpha[i] = Math.min(1, k * 8) * Math.pow(1 - k, 1.4) * 0.78;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
      this.geo.attributes.shade.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.alpha.fill(0); }
  }

  // ---------- Reifenspuren (Ringpuffer aus Quads) ----------
  class Skids {
    constructor(scene, max) {
      this.max = max || 6000;
      this.pos = new Float32Array(this.max * 4 * 3);
      this.alp = new Float32Array(this.max * 4);
      const idx = [];
      for (let i = 0; i < this.max; i++) { const v = i * 4; idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('alpha', new T.BufferAttribute(this.alp, 1).setUsage(T.DynamicDrawUsage));
      g.setIndex(idx);
      this.mat = new T.ShaderMaterial({
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.08,0.08,0.09, vA); }',
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
      this.mesh = new T.Mesh(g, this.mat); this.mesh.frustumCulled = false;
      this.geo = g; this.head = 0; this.last = {};
      scene.add(this.mesh);
    }
    add(id, x, z, dx, dz, w, a, gy) {
      gy = gy || 0;
      const L = this.last[id];
      const nx = -dz * w / 2, nz = dx * w / 2;
      if (L && a > 0.01) {
        const d = Math.hypot(x - L.x, z - L.z);
        if (d < 0.08) return;
        if (d < 3 && Math.abs(gy - (L.y || 0)) < 0.5) {
          const i = this.head; this.head = (this.head + 1) % this.max;
          const p = this.pos, o = i * 12, y = gy + 0.045, ly = (L.y || 0) + 0.045;
          p[o] = L.x + L.nx; p[o + 1] = ly; p[o + 2] = L.z + L.nz;
          p[o + 3] = L.x - L.nx; p[o + 4] = ly; p[o + 5] = L.z - L.nz;
          p[o + 6] = x + nx; p[o + 7] = y; p[o + 8] = z + nz;
          p[o + 9] = x - nx; p[o + 10] = y; p[o + 11] = z - nz;
          const al = this.alp, q = i * 4;
          al[q] = al[q + 1] = L.a; al[q + 2] = al[q + 3] = a;
          this.dirty = true;
        }
      }
      this.last[id] = a > 0.01 ? { x, z, nx, nz, a, y: gy } : null;
    }
    lift(id) { this.last[id] = null; }
    update() {
      if (!this.dirty) return;
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
      this.dirty = false;
    }
    clear() { this.pos.fill(0); this.alp.fill(0); this.last = {}; this.dirty = true; }
  }

  // ---------- Flammen aus dem Auspuff ----------
  class Flames {
    constructor(parent) {
      this.items = [];
      const mOuter = new T.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, depthWrite: false });
      const mInner = new T.MeshBasicMaterial({ color: 0xfff1a6, transparent: true, depthWrite: false });
      this.group = new T.Group(); parent.add(this.group);
      this.mOuter = mOuter; this.mInner = mInner;
      const cone = new T.ConeGeometry(0.07, 0.42, 10); cone.rotateZ(Math.PI / 2); cone.translate(-0.21, 0, 0);
      const cone2 = new T.ConeGeometry(0.04, 0.24, 10); cone2.rotateZ(Math.PI / 2); cone2.translate(-0.12, 0, 0);
      this.geo = [cone, cone2];
    }
    setAt(points) {
      this.points = points;
      for (const p of points) {
        const g = new T.Group();
        const o = new T.Mesh(this.geo[0], this.mOuter), i = new T.Mesh(this.geo[1], this.mInner);
        g.add(o, i); g.position.copy(p); g.visible = false; this.group.add(g); this.items.push(g);
      }
    }
    update(dt, active, big) {
      this.t = (this.t || 0) + dt;
      const k = big || 1;
      for (const g of this.items) {
        g.visible = active;
        if (active) { const s = (0.6 + Math.random() * 0.8) * k; g.scale.set(s, (0.8 + Math.random() * 0.5) * Math.sqrt(k), (0.8 + Math.random() * 0.5) * Math.sqrt(k)); }
      }
    }
  }

  // ---------- Funken (beim Einschlag in die Mauer) ----------
  class Sparks {
    constructor(scene, max) {
      this.max = max || 240;
      this.pos = new Float32Array(this.max * 3); this.vel = new Float32Array(this.max * 3);
      this.life = new Float32Array(this.max); this.alpha = new Float32Array(this.max); this.head = 0; this.live = 0;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
      this.mat = new T.ShaderMaterial({
        uniforms: { scale: { value: 600 } },
        vertexShader: 'attribute float alpha; uniform float scale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, 0.09 * scale / -mv.z); vA = alpha; }',
        fragmentShader: 'varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.7), vA) * (1.0 - r * 0.5), vA); }',
        transparent: true, depthWrite: false, blending: T.AdditiveBlending
      });
      this.points = new T.Points(g, this.mat); this.points.frustumCulled = false; this.geo = g;
      scene.add(this.points);
    }
    burst(x, y, z, dx, dz, n, power) {
      for (let k = 0; k < n; k++) {
        const i = this.head; this.head = (this.head + 1) % this.max;
        const j = () => Math.random() - 0.5, p = power * (0.4 + Math.random());
        this.pos[i * 3] = x + j() * 0.4; this.pos[i * 3 + 1] = y + Math.random() * 0.5; this.pos[i * 3 + 2] = z + j() * 0.4;
        this.vel[i * 3] = dx * p + j() * 5; this.vel[i * 3 + 1] = 1.5 + Math.random() * 4.5; this.vel[i * 3 + 2] = dz * p + j() * 5;
        this.life[i] = 0.35 + Math.random() * 0.55;
      }
      this.live = 1;
    }
    update(dt) {
      if (!this.live) return;
      let any = false;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
        any = true; this.life[i] -= dt;
        this.vel[i * 3 + 1] -= 14 * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        if (this.pos[i * 3 + 1] < 0.03) { this.pos[i * 3 + 1] = 0.03; this.vel[i * 3 + 1] *= -0.35; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
        this.alpha[i] = Math.max(0, Math.min(1, this.life[i] * 2.4));
      }
      this.live = any ? 1 : 0;
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
    }
  }

  window.FX = { Smoke, Skids, Flames, Sparks };
})();
