/* <spray-current> — grain-fluid memory background.
   Public API (page-driven): style-index="N" attribute (4-pair color sync),
   press(x,y) / release() for the style-cycling pointer, nudge(x,y,fx,fy,r)
   for external force injection, setObstacles(rects) for solid card obstacles
   the fluid deflects around and grains collide with, reset() for a fresh field
   on re-entry, and
   the `paused` property to gate the sim while occluded.
   ~200k persistent grains ride an invisible fluid field on the navy base; color
   lives on the grains and accumulates every color the visitor introduces.
   Grains never die: a new emission overwrites pool slots in strict rotation
   (oldest-emitted first), so density is capped at the fixed pool size.
   Rendering uses premultiplied OVER blending — stacked grains converge to a
   boosted grain color (BRIGHT_BOOST) instead of summing to white.
   The fluid decays exponentially and snaps to true zero below SNAP_EPS so the
   field genuinely comes to rest (residual creep once herded grains into dots).
   External color sync: the page owns styleIndex and sets style-index="N" (same
   4-pair order). The component never cycles on its own and never writes --acc.
   Page calls press(clientX,clientY) on the style-cycling pointerdown (budget
   reset + announce burst + pulse) and release() on pointerup (ends hold-pour).
   `paused` property gates the sim loop (page pauses it while fully occluded).
   Keeps: prefers-reduced-motion static field, hidden-tab pause, DPR cap 2,
   WebGL2 CSS fallback (host's own navy gradient). */
(() => {
  'use strict';
  if (customElements.get('spray-current')) return;

  // shared page-wide rAF ticker (first definition wins; the page and both heroes subscribe)
  window.__fsTicker = window.__fsTicker || (function () {
    const subs = new Set();
    const loop = (t) => { requestAnimationFrame(loop); subs.forEach((f) => f(t)); };
    requestAnimationFrame(loop);
    return { add: (f) => subs.add(f), remove: (f) => subs.delete(f), _subs: subs };
  })();

  /* ============================== CONFIG ================================ */
  const CONFIG = {
    PARTICLE_TEX: 448,         // particle count = TEX^2 (448 -> 200,704)
    SIM_RESOLUTION: 144,
    VELOCITY_DISSIPATION: 0.75, // exponential current decay (higher = shorter-lived stir)
    SNAP_EPS: 0.5,             // velocity below this snaps to 0 — field truly rests
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 11,
    SPLAT_RADIUS: 0.005,
    SPLAT_FORCE: 2600,
    ADVECT_SCALE: 0.7,
    JITTER: 0.012,
    POINT_SIZE: 3.0,
    SIZE_VARIANCE: 0.35,
    GRAIN_ALPHA: 0.30,
    BRIGHT_BOOST: 1.4,         // stacked grains converge to color*boost (capped < white)
    SPARKLE_SHARE: 0.04,
    EMIT_BASE: 0.0014,
    EMIT_PER_UV: 0.04,
    EMIT_MAX: 0.0045,
    EMIT_BUDGET: 0.20,
    HOLD_MULT: 1.6,
    BUDGET_TAPER: 0.3,
    EMIT_SPREAD: 0.048,
    BURST_FRACTION: 0.05,
    BURST_SPREAD: 0.045,
    PULSE_SPLATS: 14,
    PULSE_FORCE: 550,
    OBS_PUSH: 2.2,          // boundary-velocity boost for moving/resizing obstacles
    OBS_VEL_MAX: 420,       // clamp injected obstacle velocity (sim units)
  };
  /* grain color pairs — same order as the page stylesDef: cyan/coral/lime/fuchsia */
  const STYLES = [
    { v1: [0.208, 0.816, 0.859], v2: [0.302, 0.373, 0.878] },
    { v1: [1.000, 0.404, 0.385], v2: [0.845, 0.183, 0.574] },
    { v1: [0.574, 0.827, 0.425], v2: [0.000, 0.729, 0.634] },
    { v1: [0.909, 0.323, 0.878], v2: [0.463, 0.295, 0.900] },
  ];
  /* ====================================================================== */

  class SprayCurrent extends HTMLElement {
    static get observedAttributes() { return ['style-index']; }

    attributeChangedCallback(name, oldV, newV) {
      if (name !== 'style-index' || newV == null) return;
      const i = parseInt(newV, 10);
      if (isNaN(i)) return;
      this._styleIndex = ((i % STYLES.length) + STYLES.length) % STYLES.length;
      // first external seed before any interaction: re-fill the field in that pair
      if (!this._seeded && this._reseed) this._reseed();
      this._seeded = true;
    }

    get paused() { return !!this._paused; }
    set paused(v) { this._paused = !!v; }

    press() {} /* replaced after GL init */
    release() {}
    emit() {}
    setObstacles() {}

    connectedCallback() {
      if (this._booted) return;
      this._booted = true;
      this.style.display = 'block';
      if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
      // fill the mount — the element renders 0-height otherwise
      if (!this.style.width) this.style.width = '100%';
      if (!this.style.height) this.style.height = '100%';
      // CSS fallback + pre-first-frame paint: the navy base lives on the host
      this.style.background = 'radial-gradient(120% 90% at 50% 40%, #0D1024, #090B1A)';

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      this.appendChild(canvas);

      this._rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (this._styleIndex === undefined) {
        const a = parseInt(this.getAttribute('style-index') || '', 10);
        this._styleIndex = isNaN(a) ? Math.floor(Math.random() * STYLES.length) : a;
        if (!isNaN(a)) this._seeded = true;
      }

      const gl = canvas.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false });
      const floatOk = gl && gl.getExtension('EXT_color_buffer_float');
      if (!gl || !floatOk) { canvas.remove(); return; } // host gradient = fallback
      this._run(canvas, gl);
    }

    disconnectedCallback() {
      this._dead = true;
      if (this._cleanup) this._cleanup();
    }

    _run(canvas, gl) {
      const self = this;

      /* ---------------- shader plumbing ---------------- */
      function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh), src);
        return sh;
      }
      function program(vsSrc, fsSrc, attrName) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.bindAttribLocation(p, 0, attrName);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
        const uniforms = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
          const name = gl.getActiveUniform(p, i).name;
          uniforms[name.replace('[0]', '')] = gl.getUniformLocation(p, name);
        }
        return { p, u: uniforms, bind() { gl.useProgram(p); } };
      }

      const quadVS = `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv; varying vec2 vL, vR, vT, vB;
        uniform vec2 texelSize;
        void main () {
          vUv = aPosition * 0.5 + 0.5;
          vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
          vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }`;

      /* ---------------- fluid shaders (velocity only) ---------------- */
      const clearFS = `precision mediump float;varying vec2 vUv;uniform sampler2D uTexture;uniform float value;
        void main(){gl_FragColor=value*texture2D(uTexture,vUv);}`;
      const splatFS = `precision highp float;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspectRatio;
        uniform vec3 color;uniform vec2 point;uniform float radius;
        void main(){vec2 p=vUv-point;p.x*=aspectRatio;
        gl_FragColor=vec4(texture2D(uTarget,vUv).xyz+exp(-dot(p,p)/radius)*color,1.0);}`;
      const advectFS = `precision highp float;varying vec2 vUv;uniform sampler2D uVelocity;uniform sampler2D uSource;
        uniform vec2 texelSize;uniform float dt;uniform float dissipation;
        void main(){vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize;
        vec4 v=texture2D(uSource,coord)/(1.0+dissipation*dt);
        if(length(v.xy)<${CONFIG.SNAP_EPS}){v.xy=vec2(0.0);}
        gl_FragColor=v;}`;
      const divFS = `precision mediump float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;
        void main(){float L=texture2D(uVelocity,vL).x;float R=texture2D(uVelocity,vR).x;
        float T=texture2D(uVelocity,vT).y;float B=texture2D(uVelocity,vB).y;vec2 C=texture2D(uVelocity,vUv).xy;
        if(vL.x<0.0){L=-C.x;}if(vR.x>1.0){R=-C.x;}if(vT.y>1.0){T=-C.y;}if(vB.y<0.0){B=-C.y;}
        gl_FragColor=vec4(0.5*(R-L+T-B),0.0,0.0,1.0);}`;
      const curlFS = `precision mediump float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;
        void main(){float L=texture2D(uVelocity,vL).y;float R=texture2D(uVelocity,vR).y;
        float T=texture2D(uVelocity,vT).x;float B=texture2D(uVelocity,vB).x;
        gl_FragColor=vec4(0.5*(R-L-T+B),0.0,0.0,1.0);}`;
      const vortFS = `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;uniform sampler2D uCurl;
        uniform float curl;uniform float dt;
        void main(){float L=texture2D(uCurl,vL).x;float R=texture2D(uCurl,vR).x;float T=texture2D(uCurl,vT).x;
        float B=texture2D(uCurl,vB).x;float C=texture2D(uCurl,vUv).x;
        vec2 force=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L));force/=length(force)+0.0001;force*=curl*C;force.y*=-1.0;
        vec2 v=texture2D(uVelocity,vUv).xy+force*dt;gl_FragColor=vec4(clamp(v,-1000.0,1000.0),0.0,1.0);}`;
      const presFS = `precision mediump float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure;uniform sampler2D uDivergence;
        void main(){float L=texture2D(uPressure,vL).x;float R=texture2D(uPressure,vR).x;float T=texture2D(uPressure,vT).x;
        float B=texture2D(uPressure,vB).x;float d=texture2D(uDivergence,vUv).x;
        gl_FragColor=vec4((L+R+B+T-d)*0.25,0.0,0.0,1.0);}`;
      const gradFS = `precision mediump float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure;uniform sampler2D uVelocity;
        void main(){float L=texture2D(uPressure,vL).x;float R=texture2D(uPressure,vR).x;float T=texture2D(uPressure,vT).x;
        float B=texture2D(uPressure,vB).x;vec2 v=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);
        gl_FragColor=vec4(v,0.0,1.0);}`;

      /* ---- solid obstacles: up to 3 rounded-rect SDFs (aspect-corrected UV).
         uObsA = center.xy + half-size.zw; uObsB = translation vel.xy + half-size
         growth rate.zw (sim units); uObsR = corner radius. obsField returns the
         signed distance and the local solid velocity (translation + affine
         expansion), so moving/resizing cards plow the fluid. ---- */
      const obsGLSL = `
        uniform float uObsN; uniform float uAspect;
        uniform vec4 uObsA[3]; uniform vec4 uObsB[3]; uniform float uObsR[3];
        float obsField(vec2 uv, out vec2 ovel) {
          float d = 1e5; ovel = vec2(0.0);
          vec2 p2 = vec2(uv.x * uAspect, uv.y);
          for (int i = 0; i < 3; i++) {
            if (float(i) >= uObsN) break;
            vec2 rel = p2 - uObsA[i].xy;
            vec2 hs = max(uObsA[i].zw, vec2(1e-4));
            vec2 q = abs(rel) - uObsA[i].zw + uObsR[i];
            float di = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uObsR[i];
            if (di < d) { d = di; ovel = uObsB[i].xy + clamp(rel / hs, vec2(-1.0), vec2(1.0)) * uObsB[i].zw; }
          }
          return d;
        }`;
      /* pin the velocity field to the solid's velocity inside each obstacle;
         the pressure solve then deflects the surrounding current around it */
      const obsFS = `precision highp float;varying vec2 vUv;uniform sampler2D uVelocity;
        ${obsGLSL}
        void main(){
          vec2 v = texture2D(uVelocity, vUv).xy;
          vec2 ov; float d = obsField(vUv, ov);
          float m = 1.0 - smoothstep(0.0, 0.008, d);
          gl_FragColor = vec4(mix(v, ov, m), 0.0, 1.0);
        }`;

      /* ---------------- particle shaders ---------------- */
      const hashGLSL = `
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
        vec2 hash2(vec2 p){return vec2(hash(p),hash(p+vec2(17.13,3.71)));}`;

      const partUpdateFS = `precision highp float;varying vec2 vUv;
        uniform sampler2D uPos;
        uniform sampler2D uVelocity;
        uniform vec2 uVelTexel;
        uniform float dt; uniform float uTime;
        uniform float uAdvect; uniform float uJitter;
        uniform float uBurstFlag; uniform float uBurstA; uniform float uBurstB;
        uniform vec2 uBurstPos; uniform vec2 uBurstPos2; uniform float uBurstSpread;
        uniform float uTexSize;
        ${hashGLSL}
        ${obsGLSL}
        void main(){
          vec4 p = texture2D(uPos, vUv);
          float idx = (floor(vUv.y*uTexSize)*uTexSize + floor(vUv.x*uTexSize)) / (uTexSize*uTexSize);
          bool inBurst = false;
          if (uBurstFlag > 0.5) {
            float a = uBurstA, b = uBurstB;
            inBurst = (idx >= a && idx < b) || (idx + 1.0 >= a && idx + 1.0 < b);
          }
          if (inBurst) {
            vec2 g = hash2(vUv * 91.7 + uTime);
            vec2 g3 = hash2(vUv * 57.9 + uTime * 0.61);
            float ang = g.x * 6.2831853;
            float rad = uBurstSpread * (g.y + g3.x) * 0.5 * 1.35;
            vec2 base = mix(uBurstPos2, uBurstPos, g3.y);
            p.xy = base + vec2(cos(ang), sin(ang)) * rad;
            p.z = 0.0; // age resets: short fade-in at spawn
          } else {
            vec2 vel = texture2D(uVelocity, p.xy).xy;
            p.xy += vel * uVelTexel * uAdvect * dt;
            p.xy += (hash2(vUv * 13.7 + uTime) - 0.5) * uJitter * dt;
            p.xy = fract(p.xy);
            // solid collision: project grains inside an obstacle to its nearest edge
            if (uObsN > 0.5) {
              vec2 p2 = vec2(p.x * uAspect, p.y);
              for (int i = 0; i < 3; i++) {
                if (float(i) >= uObsN) break;
                vec2 rel = p2 - uObsA[i].xy;
                vec2 q = abs(rel) - uObsA[i].zw + uObsR[i];
                float di = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uObsR[i];
                if (di < 0.0) {
                  vec2 sgn = vec2(rel.x >= 0.0 ? 1.0 : -1.0, rel.y >= 0.0 ? 1.0 : -1.0);
                  vec2 gdir = (q.x > 0.0 || q.y > 0.0)
                    ? normalize(max(q, vec2(0.0)) + 1e-6) * sgn
                    : (q.x > q.y ? vec2(sgn.x, 0.0) : vec2(0.0, sgn.y));
                  p2 += gdir * (0.0015 - di);
                }
              }
              p.xy = vec2(p2.x / uAspect, p2.y);
            }
            p.z += dt; // age — used only for spawn fade-in; grains persist until
            // their slot is overwritten by a new emission (burstCursor, oldest-first)
          }
          gl_FragColor = p;
        }`;

      const colorUpdateFS = `precision highp float;varying vec2 vUv;
        uniform sampler2D uColor;
        uniform float uBurstA; uniform float uBurstB;
        uniform vec3 uC1; uniform vec3 uC2;
        uniform float uTexSize; uniform float uTime;
        ${hashGLSL}
        void main(){
          vec4 c = texture2D(uColor, vUv);
          float idx = (floor(vUv.y*uTexSize)*uTexSize + floor(vUv.x*uTexSize)) / (uTexSize*uTexSize);
          float a = uBurstA, b = uBurstB;
          bool inBurst = (idx >= a && idx < b) || (idx + 1.0 >= a && idx + 1.0 < b);
          if (inBurst) {
            float t = hash(vUv * 53.1 + uTime);
            float lum = 0.65 + 0.35 * hash(vUv * 29.7 + uTime);
            c = vec4(mix(uC1, uC2, t) * lum, 1.0);
          }
          gl_FragColor = c;
        }`;

      const pointVS = `precision highp float;
        attribute float aIndex;
        uniform sampler2D uPos; uniform sampler2D uColor;
        uniform float uTexSize; uniform float uPointSize; uniform float uSizeVar;
        varying vec3 vColor; varying float vFade;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
        void main(){
          vec2 slot = vec2(mod(aIndex, uTexSize) + 0.5, floor(aIndex / uTexSize) + 0.5) / uTexSize;
          vec4 p = texture2D(uPos, slot);
          vec4 c = texture2D(uColor, slot);
          vFade = smoothstep(0.0, 0.45, p.z); // fade-in on spawn only; no death fade
          vColor = c.rgb;
          gl_Position = vec4(p.xy * 2.0 - 1.0, 0.0, 1.0);
          float sizeF = 1.0 + (hash(slot * 17.9) - 0.5) * 2.0 * uSizeVar;
          gl_PointSize = uPointSize * sizeF;
        }`;

      const pointFS = `precision highp float;
        varying vec3 vColor; varying float vFade;
        uniform float uAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * uAlpha * vFade;
          // premultiplied OVER blending: overlaps converge to a boosted grain
          // color (BRIGHT_BOOST) instead of summing to white
          gl_FragColor = vec4(min(vColor * ${CONFIG.BRIGHT_BOOST}, vec3(1.0)) * a, a);
        }`;

      const bgFS = `precision highp float;varying vec2 vUv;
        uniform vec3 uBase; uniform vec3 uBaseDeep;
        void main(){
          float vig = distance(vUv, vec2(0.5, 0.42));
          gl_FragColor = vec4(mix(uBase, uBaseDeep, smoothstep(0.2, 0.85, vig)), 1.0);
        }`;

      const P = {
        clear: program(quadVS, clearFS, 'aPosition'),
        splat: program(quadVS, splatFS, 'aPosition'),
        advect: program(quadVS, advectFS, 'aPosition'),
        div: program(quadVS, divFS, 'aPosition'),
        curl: program(quadVS, curlFS, 'aPosition'),
        vort: program(quadVS, vortFS, 'aPosition'),
        pres: program(quadVS, presFS, 'aPosition'),
        grad: program(quadVS, gradFS, 'aPosition'),
        obs: program(quadVS, obsFS, 'aPosition'),
        partUpdate: program(quadVS, partUpdateFS, 'aPosition'),
        colorUpdate: program(quadVS, colorUpdateFS, 'aPosition'),
        points: program(pointVS, pointFS, 'aIndex'),
        bg: program(quadVS, bgFS, 'aPosition'),
      };

      /* ---------------- geometry ---------------- */
      const T = CONFIG.PARTICLE_TEX;
      const COUNT = T * T;

      const vaoQuad = gl.createVertexArray();
      gl.bindVertexArray(vaoQuad);
      const qb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW);
      const qi = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, qi);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);

      const vaoPoints = gl.createVertexArray();
      gl.bindVertexArray(vaoPoints);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      const indices = new Float32Array(COUNT);
      for (let i = 0; i < COUNT; i++) indices[i] = i;
      gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      gl.bindVertexArray(vaoQuad);

      function blit(target) {
        gl.bindVertexArray(vaoQuad);
        if (target == null) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }

      /* ---------------- FBOs ---------------- */
      function createFBO(w, h, internalFormat, format, type, filter, data) {
        gl.activeTexture(gl.TEXTURE0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data || null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (!data) { gl.viewport(0, 0, w, h); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); }
        return {
          texture, fbo, width: w, height: h,
          texelSizeX: 1 / w, texelSizeY: 1 / h,
          attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
        };
      }
      function createDoubleFBO(w, h, iF, f, t, filter, data1) {
        let a = createFBO(w, h, iF, f, t, filter, data1);
        let b = createFBO(w, h, iF, f, t, filter, null);
        return {
          width: w, height: h, texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
          get read() { return a; }, get write() { return b; },
          swap() { const t2 = a; a = b; b = t2; }
        };
      }
      function getResolution(res) {
        let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspect < 1) aspect = 1 / aspect;
        const min = Math.round(res), max = Math.round(res * aspect);
        return gl.drawingBufferWidth > gl.drawingBufferHeight
          ? { width: max, height: min } : { width: min, height: max };
      }

      const rand = (a, b) => a + Math.random() * (b - a);
      function initialPosData() {
        const d = new Float32Array(COUNT * 4);
        for (let i = 0; i < COUNT; i++) {
          d[i*4] = Math.random();
          d[i*4+1] = Math.random();
          d[i*4+2] = 1;   // age: starts past the spawn fade-in (fully visible)
          d[i*4+3] = 0;   // unused channel
        }
        return d;
      }
      function initialColorData() {
        const s = STYLES[self._styleIndex];
        const d = new Float32Array(COUNT * 4);
        for (let i = 0; i < COUNT; i++) {
          if (Math.random() < CONFIG.SPARKLE_SHARE) {
            const t = Math.random();
            d[i*4]   = 0.85 + 0.35 * (s.v1[0] + (s.v2[0] - s.v1[0]) * t);
            d[i*4+1] = 0.85 + 0.35 * (s.v1[1] + (s.v2[1] - s.v1[1]) * t);
            d[i*4+2] = 0.90 + 0.35 * (s.v1[2] + (s.v2[2] - s.v1[2]) * t);
          } else {
            const t = Math.random(), lum = rand(0.7, 1.05);
            d[i*4]   = (s.v1[0] + (s.v2[0] - s.v1[0]) * t) * lum;
            d[i*4+1] = (s.v1[1] + (s.v2[1] - s.v1[1]) * t) * lum;
            d[i*4+2] = (s.v1[2] + (s.v2[2] - s.v1[2]) * t) * lum;
          }
          d[i*4+3] = 1;
        }
        return d;
      }

      let velocity, divergenceFBO, curlFBO, pressureFBO, posFBO, colorFBO;
      function initFramebuffers() {
        const simRes = getResolution(CONFIG.SIM_RESOLUTION);
        velocity      = createDoubleFBO(simRes.width, simRes.height, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
        divergenceFBO = createFBO(simRes.width, simRes.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
        curlFBO       = createFBO(simRes.width, simRes.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
        pressureFBO   = createDoubleFBO(simRes.width, simRes.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
      }
      function initParticles() {
        posFBO   = createDoubleFBO(T, T, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, initialPosData());
        colorFBO = createDoubleFBO(T, T, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, initialColorData());
      }
      // page seeds the shared style asynchronously; before any interaction we
      // re-fill the field so initial grains match this visit's accent pair
      self._reseed = () => {
        if (colorFBO) colorFBO = createDoubleFBO(T, T, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, initialColorData());
        if (self._rm) render();
      };

      function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if ((canvas.width !== w || canvas.height !== h) && w > 0 && h > 0) {
          canvas.width = w; canvas.height = h;
          return true;
        }
        return false;
      }
      resizeCanvas();
      initFramebuffers();
      initParticles();

      /* ---------------- fluid step ---------------- */
      function fluidSplat(x, y, dx, dy, radiusScale) {
        P.splat.bind();
        gl.uniform2f(P.splat.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(P.splat.u.uTarget, velocity.read.attach(0));
        gl.uniform1f(P.splat.u.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(P.splat.u.point, x, y);
        gl.uniform3f(P.splat.u.color, dx, dy, 0);
        let radius = CONFIG.SPLAT_RADIUS * (radiusScale || 1);
        const aspect = canvas.width / canvas.height;
        if (aspect > 1) radius *= aspect;
        gl.uniform1f(P.splat.u.radius, radius);
        blit(velocity.write); velocity.swap();
      }

      function fluidStep(dt) {
        gl.disable(gl.BLEND);
        const tx = velocity.texelSizeX, ty = velocity.texelSizeY;
        // pin solid-obstacle cells first so the whole solve sees the boundary
        if (obsState.n > 0) {
          P.obs.bind();
          gl.uniform2f(P.obs.u.texelSize, tx, ty);
          gl.uniform1i(P.obs.u.uVelocity, velocity.read.attach(0));
          setObsUniforms(P.obs);
          blit(velocity.write); velocity.swap();
        }
        P.curl.bind();
        gl.uniform2f(P.curl.u.texelSize, tx, ty);
        gl.uniform1i(P.curl.u.uVelocity, velocity.read.attach(0));
        blit(curlFBO);
        P.vort.bind();
        gl.uniform2f(P.vort.u.texelSize, tx, ty);
        gl.uniform1i(P.vort.u.uVelocity, velocity.read.attach(0));
        gl.uniform1i(P.vort.u.uCurl, curlFBO.attach(1));
        gl.uniform1f(P.vort.u.curl, CONFIG.CURL);
        gl.uniform1f(P.vort.u.dt, dt);
        blit(velocity.write); velocity.swap();
        P.div.bind();
        gl.uniform2f(P.div.u.texelSize, tx, ty);
        gl.uniform1i(P.div.u.uVelocity, velocity.read.attach(0));
        blit(divergenceFBO);
        P.clear.bind();
        gl.uniform2f(P.clear.u.texelSize, tx, ty);
        gl.uniform1i(P.clear.u.uTexture, pressureFBO.read.attach(0));
        gl.uniform1f(P.clear.u.value, CONFIG.PRESSURE);
        blit(pressureFBO.write); pressureFBO.swap();
        P.pres.bind();
        gl.uniform2f(P.pres.u.texelSize, tx, ty);
        gl.uniform1i(P.pres.u.uDivergence, divergenceFBO.attach(0));
        for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
          gl.uniform1i(P.pres.u.uPressure, pressureFBO.read.attach(1));
          blit(pressureFBO.write); pressureFBO.swap();
        }
        P.grad.bind();
        gl.uniform2f(P.grad.u.texelSize, tx, ty);
        gl.uniform1i(P.grad.u.uPressure, pressureFBO.read.attach(0));
        gl.uniform1i(P.grad.u.uVelocity, velocity.read.attach(1));
        blit(velocity.write); velocity.swap();
        P.advect.bind();
        gl.uniform2f(P.advect.u.texelSize, tx, ty);
        const vid = velocity.read.attach(0);
        gl.uniform1i(P.advect.u.uVelocity, vid);
        gl.uniform1i(P.advect.u.uSource, vid);
        gl.uniform1f(P.advect.u.dt, dt);
        gl.uniform1f(P.advect.u.dissipation, CONFIG.VELOCITY_DISSIPATION);
        blit(velocity.write); velocity.swap();
      }

      /* ---------------- solid obstacles (page-driven card rects) ---------------- */
      const obsState = { n: 0, A: new Float32Array(12), B: new Float32Array(12), R: new Float32Array(3) };
      function setObsUniforms(prog) {
        gl.uniform1f(prog.u.uObsN, obsState.n);
        gl.uniform1f(prog.u.uAspect, canvas.width / canvas.height);
        gl.uniform4fv(prog.u.uObsA, obsState.A);
        gl.uniform4fv(prog.u.uObsB, obsState.B);
        gl.uniform1fv(prog.u.uObsR, obsState.R);
      }
      /* rects: [{left,top,width,height,radius, vx,vy (center px/s), gx,gy
         (half-size growth px/s)}] in client px; max 3, empty array clears */
      self.setObstacles = (list) => {
        if (self._rm || !list || !list.length) { obsState.n = 0; return; }
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) { obsState.n = 0; return; }
        const aspect = canvas.width / canvas.height;
        const simW = 1 / velocity.texelSizeX, simH = 1 / velocity.texelSizeY;
        const cl = (v) => Math.max(-CONFIG.OBS_VEL_MAX, Math.min(CONFIG.OBS_VEL_MAX, v));
        obsState.n = Math.min(list.length, 3);
        for (let i = 0; i < obsState.n; i++) {
          const o = list[i];
          const hw = (o.width / 2 / rect.width) * aspect;
          const hh = o.height / 2 / rect.height;
          obsState.A[i*4]   = ((o.left + o.width / 2 - rect.left) / rect.width) * aspect;
          obsState.A[i*4+1] = 1 - (o.top + o.height / 2 - rect.top) / rect.height;
          obsState.A[i*4+2] = hw;
          obsState.A[i*4+3] = hh;
          obsState.B[i*4]   = cl(((o.vx || 0) / rect.width) * simW * CONFIG.OBS_PUSH);
          obsState.B[i*4+1] = cl((-(o.vy || 0) / rect.height) * simH * CONFIG.OBS_PUSH); // page y-down -> sim y-up
          obsState.B[i*4+2] = cl(((o.gx || 0) / rect.width) * simW * CONFIG.OBS_PUSH);   // growth is symmetric: no flip
          obsState.B[i*4+3] = cl(((o.gy || 0) / rect.height) * simH * CONFIG.OBS_PUSH);
          obsState.R[i] = Math.min((o.radius || 0) / rect.height, Math.min(hw, hh));
        }
      };

      /* ---------------- particle step + burst/emission queue ---------------- */
      const burstQueue = [];
      let burstCursor = Math.random();
      function enqueueBurst(fraction, x, y, spread, x2, y2) {
        const s = STYLES[self._styleIndex];
        const a = burstCursor;
        const b = burstCursor + fraction;
        burstCursor = b % 1;
        burstQueue.push({ a, b, x, y, x2: x2 === undefined ? x : x2, y2: y2 === undefined ? y : y2, spread, c1: s.v1, c2: s.v2 });
        if (burstQueue.length > 6) burstQueue.splice(0, burstQueue.length - 6);
      }

      function particleStep(dt, now) {
        const pendingBurst = burstQueue.length ? burstQueue.shift() : null;
        P.partUpdate.bind();
        gl.uniform1i(P.partUpdate.u.uPos, posFBO.read.attach(0));
        gl.uniform1i(P.partUpdate.u.uVelocity, velocity.read.attach(1));
        gl.uniform2f(P.partUpdate.u.uVelTexel, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1f(P.partUpdate.u.dt, dt);
        gl.uniform1f(P.partUpdate.u.uTime, now * 0.001 % 1000);
        gl.uniform1f(P.partUpdate.u.uAdvect, CONFIG.ADVECT_SCALE);
        gl.uniform1f(P.partUpdate.u.uJitter, CONFIG.JITTER);
        gl.uniform1f(P.partUpdate.u.uTexSize, T);
        setObsUniforms(P.partUpdate);
        if (pendingBurst) {
          gl.uniform1f(P.partUpdate.u.uBurstFlag, 1);
          gl.uniform1f(P.partUpdate.u.uBurstA, pendingBurst.a);
          gl.uniform1f(P.partUpdate.u.uBurstB, pendingBurst.b);
          gl.uniform2f(P.partUpdate.u.uBurstPos, pendingBurst.x, pendingBurst.y);
          gl.uniform2f(P.partUpdate.u.uBurstPos2, pendingBurst.x2, pendingBurst.y2);
          gl.uniform1f(P.partUpdate.u.uBurstSpread, pendingBurst.spread);
        } else {
          gl.uniform1f(P.partUpdate.u.uBurstFlag, 0); // burst uniforms unread when flag is 0
        }
        blit(posFBO.write); posFBO.swap();

        if (pendingBurst) {
          P.colorUpdate.bind();
          gl.uniform1i(P.colorUpdate.u.uColor, colorFBO.read.attach(0));
          gl.uniform1f(P.colorUpdate.u.uBurstA, pendingBurst.a);
          gl.uniform1f(P.colorUpdate.u.uBurstB, pendingBurst.b);
          gl.uniform3f(P.colorUpdate.u.uC1, pendingBurst.c1[0], pendingBurst.c1[1], pendingBurst.c1[2]);
          gl.uniform3f(P.colorUpdate.u.uC2, pendingBurst.c2[0], pendingBurst.c2[1], pendingBurst.c2[2]);
          gl.uniform1f(P.colorUpdate.u.uTexSize, T);
          gl.uniform1f(P.colorUpdate.u.uTime, now * 0.001 % 1000);
          blit(colorFBO.write); colorFBO.swap();
        }
      }

      /* ---------------- render ---------------- */
      function render() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.disable(gl.BLEND);
        P.bg.bind();
        gl.uniform3f(P.bg.u.uBase, 0.051, 0.063, 0.141);
        gl.uniform3f(P.bg.u.uBaseDeep, 0.035, 0.043, 0.102);
        blit(null);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // capped accumulation (no white blowout)
        P.points.bind();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        gl.uniform1i(P.points.u.uPos, posFBO.read.attach(0));
        gl.uniform1i(P.points.u.uColor, colorFBO.read.attach(1));
        gl.uniform1f(P.points.u.uTexSize, T);
        gl.uniform1f(P.points.u.uPointSize, CONFIG.POINT_SIZE * dpr);
        gl.uniform1f(P.points.u.uSizeVar, CONFIG.SIZE_VARIANCE);
        gl.uniform1f(P.points.u.uAlpha, CONFIG.GRAIN_ALPHA);
        gl.bindVertexArray(vaoPoints);
        gl.drawArrays(gl.POINTS, 0, COUNT);
        gl.bindVertexArray(vaoQuad);
        gl.disable(gl.BLEND);
      }

      /* ---------------- pointer (window-level: canvas sits behind content) --- */
      const pointer = { x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, moved: false, seeded: false, down: false };
      const onMove = e => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = 1 - (e.clientY - rect.top) / rect.height;
        if (!pointer.seeded) { pointer.x = nx; pointer.y = ny; pointer.px = nx; pointer.py = ny; pointer.seeded = true; return; }
        pointer.px = pointer.x; pointer.py = pointer.y;
        pointer.dx = (nx - pointer.x) * CONFIG.SPLAT_FORCE;
        pointer.dy = (ny - pointer.y) * CONFIG.SPLAT_FORCE;
        pointer.x = nx; pointer.y = ny;
        pointer.moved = Math.abs(pointer.dx) > 0.5 || Math.abs(pointer.dy) > 0.5;
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      const onUp = () => { pointer.down = false; };
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onUp, { passive: true });

      let emitBudget = CONFIG.EMIT_BUDGET; // the opening batch

      /* the page calls press() on the same pointerdown that cycles styleIndex
         (attribute already updated), so the burst announces the NEW color */
      self.press = (clientX, clientY) => {
        self._seeded = true;
        pointer.down = true;
        emitBudget = CONFIG.EMIT_BUDGET;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const cx = (clientX - rect.left) / rect.width;
        const cy = 1 - (clientY - rect.top) / rect.height;
        pointer.x = cx; pointer.y = cy; pointer.px = cx; pointer.py = cy; pointer.seeded = true;
        enqueueBurst(CONFIG.BURST_FRACTION, cx, cy, CONFIG.BURST_SPREAD);
        if (!self._rm) {
          for (let i = 0; i < CONFIG.PULSE_SPLATS; i++) {
            const ang = (i / CONFIG.PULSE_SPLATS) * Math.PI * 2;
            fluidSplat(cx + Math.cos(ang) * 0.015, cy + Math.sin(ang) * 0.015,
                       Math.cos(ang) * CONFIG.PULSE_FORCE, Math.sin(ang) * CONFIG.PULSE_FORCE, 1.5);
          }
        } else {
          particleStep(0.016, performance.now());
          render();
        }
      };
      self.release = () => { pointer.down = false; };
      /* external particle emission: spawns fraction×pool grains spread along the
         line (clientX,clientY)→(clientX2,clientY2) in the current style pair */
      self.emit = (clientX, clientY, fraction, spread, clientX2, clientY2) => {
        if (self._rm) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const cx = (clientX - rect.left) / rect.width;
        const cy = 1 - (clientY - rect.top) / rect.height;
        const cx2 = clientX2 === undefined ? cx : (clientX2 - rect.left) / rect.width;
        const cy2 = clientY2 === undefined ? cy : 1 - (clientY2 - rect.top) / rect.height;
        enqueueBurst(fraction, cx, cy, spread || CONFIG.EMIT_SPREAD, cx2, cy2);
      };
      /* external force injection: page sweeps card edges through the field.
         clientX/Y in page px; fx/fy in sim force units (mouse uses ~SPLAT_FORCE * uv-delta) */
      self.nudge = (clientX, clientY, fx, fy, radiusScale) => {
        if (self._rm || self._paused) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const cx = (clientX - rect.left) / rect.width;
        const cy = 1 - (clientY - rect.top) / rect.height;
        if (cx < -0.1 || cx > 1.1 || cy < -0.1 || cy > 1.1) return;
        fluidSplat(cx, cy, fx, fy, radiusScale || 1);
      };
      /* fresh field: page calls this when the knockout transition re-enters,
         so each reveal starts from a new random state */
      self.reset = () => {
        initFramebuffers();
        initParticles();
        emitBudget = CONFIG.EMIT_BUDGET;
        if (self._rm) { render(); return; }
        openingJets();
      };

      /* opening gesture: one soft opposed cross-current so the field reads as
         alive (also fired by the page on section transitions, via nudge()) */
      function openingJets() {
        fluidSplat(0.25, 0.5, 600, 150, 4);
        fluidSplat(0.75, 0.45, -500, -120, 4);
      }

      /* ---------------- main loop (driven by the shared page ticker) ---------------- */
      let lastTime = performance.now();

      function frame() {
        if (self._dead) { window.__fsTicker.remove(frame); return; }
        if (self._paused || document.hidden) { lastTime = performance.now(); return; }
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.0166);
        lastTime = now;
        if (resizeCanvas()) initFramebuffers();
        if (pointer.moved) {
          pointer.moved = false;
          fluidSplat(pointer.x, pointer.y, pointer.dx, pointer.dy, 1);
          if (!pointer.down && emitBudget > 0.0002) {
            const travel = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py);
            let fraction = Math.min(CONFIG.EMIT_MAX, CONFIG.EMIT_BASE + travel * CONFIG.EMIT_PER_UV);
            const taper = Math.min(1, emitBudget / (CONFIG.EMIT_BUDGET * CONFIG.BUDGET_TAPER));
            fraction = Math.min(fraction * taper, emitBudget);
            emitBudget -= fraction;
            enqueueBurst(fraction, pointer.x, pointer.y, CONFIG.EMIT_SPREAD, pointer.px, pointer.py);
          }
        }
        if (pointer.down && pointer.seeded) {
          const travel = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py);
          const fraction = Math.min(CONFIG.EMIT_MAX, CONFIG.EMIT_BASE * CONFIG.HOLD_MULT + travel * CONFIG.EMIT_PER_UV);
          enqueueBurst(fraction, pointer.x, pointer.y, CONFIG.EMIT_SPREAD, pointer.px, pointer.py);
          pointer.px = pointer.x; pointer.py = pointer.y;
        }
        fluidStep(dt);
        particleStep(dt, now);
        render();
      }

      self._cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      if (self._rm) {
        render(); // static grain field
      } else {
        setTimeout(() => { if (!self._dead) openingJets(); }, 400);
        window.__fsTicker.add(frame);
      }
    }
  }

  customElements.define('spray-current', SprayCurrent);
})();
