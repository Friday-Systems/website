/* <pallet-hero> — Friday Systems interactive pallet hero.
   Port of the validated pallet-spike: all physics constants, interaction
   thresholds, return-system config and the color system are verbatim.
   Integration layer only: element-scoped sizing, page-driven color sync
   (style-index attribute), touch-action pan-y, visibility-gated loop. */
(function () {
  'use strict';

  // shared page-wide rAF ticker (first definition wins; the page and both heroes subscribe)
  window.__fsTicker = window.__fsTicker || (function () {
    var subs = new Set();
    function loop(t) { requestAnimationFrame(loop); subs.forEach(function (f) { f(t); }); }
    requestAnimationFrame(loop);
    return { add: function (f) { subs.add(f); }, remove: function (f) { subs.delete(f); }, _subs: subs };
  })();

  var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var CANNON_URL = 'https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js';

  function loadScript(src, test) {
    return new Promise(function (res, rej) {
      if (test()) return res();
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        var poll = setInterval(function () { if (test()) { clearInterval(poll); res(); } }, 40);
        setTimeout(function () { clearInterval(poll); test() ? res() : rej(new Error('timeout ' + src)); }, 12000);
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('load failed ' + src)); };
      document.head.appendChild(s);
    });
  }

  class PalletHero extends HTMLElement {
    // External color sync: the page owns the theme and sets style-index="N"
    // (same 4-style order as the spike); every change repaints the box quota.
    static get observedAttributes() { return ['style-index']; }
    attributeChangedCallback(name, oldV, newV) {
      if (name !== 'style-index' || newV == null) return;
      var i = parseInt(newV, 10);
      if (isNaN(i)) return;
      this._extIdx = i;
      if (this._adoptStyle) this._adoptStyle(i);
    }

    connectedCallback() {
      if (this._booted) return;
      this._booted = true;
      this.style.display = 'block';
      this.style.width = '100%';
      this.style.height = '100%';
      if (getComputedStyle(this).position === 'static') this.style.position = 'relative';

      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;touch-action:pan-y;cursor:crosshair;';
      this.appendChild(canvas);
      this._canvas = canvas;

      // page-driven sim gate: set while the hero scene is occluded (mirrors spray-current)
      Object.defineProperty(this, 'paused', {
        get: function () { return !!this._paused; },
        set: function (v) { this._paused = !!v; }
      });

      var self = this;
      Promise.all([
        loadScript(THREE_URL, function () { return !!window.THREE; }),
        loadScript(CANNON_URL, function () { return !!window.CANNON; })
      ]).then(function () { if (self.isConnected) self._start(); })
        .catch(function (e) { console.error('pallet-hero libs', e); });
    }

    disconnectedCallback() { this._dead = true; }

    _start() {
      var THREE = window.THREE, CANNON = window.CANNON;
      var host = this, canvas = this._canvas;

      // ============================================================
      // CONFIG — locked (validated spike values)
      // ============================================================
      var CONFIG = {
        coloredShare: 0.50,
        reshuffleShare: 0.70,
        primaryShare: 0.50,
        emissiveK: 0.22,
        transitionMs: 240,
        ghostAt: 0.80,
        riseOffset: 1.2,
        springTimeout: 4.0
      };

      var STYLES = [
        { name: 'cyan',    acc: '#35D0DB', acc2: '#4D5FE0' },
        { name: 'coral',   acc: '#FF6762', acc2: '#D72F92' },
        { name: 'lime',    acc: '#92D36C', acc2: '#00BAA2' },
        { name: 'fuchsia', acc: '#E852E0', acc2: '#764BE5' }
      ];
      var styleIndex = (Math.random() * STYLES.length) | 0;
      if (host._extIdx != null) styleIndex = ((host._extIdx % STYLES.length) + STYLES.length) % STYLES.length;

      var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var coarsePointer = window.matchMedia('(pointer: coarse)').matches;

      var GRAVITY = 9.82;
      var PAGE_BG = '#090B1A'; // must match the page --navy-deep

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;

      var scene = new THREE.Scene();
      scene.background = null;
      scene.fog = new THREE.Fog(PAGE_BG, 9, 20);

      var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
      var camBase = new THREE.Vector3(2.9, 2.15, 3.55);
      var camTarget = new THREE.Vector3(0, 0.55, 0);
      camera.position.copy(camBase);
      camera.lookAt(camTarget);

      scene.add(new THREE.HemisphereLight(0xc7ccea, 0x0b0d1c, 0.6));
      var sun = new THREE.DirectionalLight(0xfff4e0, 0.95);
      sun.position.set(3.5, 6.5, 2.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(coarsePointer ? 1024 : 2048, coarsePointer ? 1024 : 2048);
      sun.shadow.camera.left = -3; sun.shadow.camera.right = 3;
      sun.shadow.camera.top = 3;   sun.shadow.camera.bottom = -3;
      sun.shadow.camera.near = 1;  sun.shadow.camera.far = 14;
      sun.shadow.bias = -0.0015;
      scene.add(sun);

      // real floor: unlit gradient texture (exact colors, no light wash) —
      // a lit pool near/under the pallet dissolving to #090B1A (the page bg)
      // far out, so the plane has no visible edge.
      var FLOOR_FAR = PAGE_BG;
      var FLOOR_POOL = { near: '#1A2142', radius: 300 };
      function mixHex(a, b, t) {
        var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
        var g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
        var bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
        return 'rgb(' + r + ',' + g + ',' + bl + ')';
      }
      function makeFloorTex(v) {
        var c = document.createElement('canvas');
        c.width = c.height = 1024;
        var ctx = c.getContext('2d');
        ctx.fillStyle = FLOOR_FAR;
        ctx.fillRect(0, 0, 1024, 1024);
        var g = ctx.createRadialGradient(512, 512, 0, 512, 512, v.radius);
        g.addColorStop(0, v.near);
        g.addColorStop(0.55, mixHex(v.near, FLOOR_FAR, 0.55));
        g.addColorStop(1, FLOOR_FAR);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1024, 1024);
        var t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return t;
      }
      var floorMat = new THREE.MeshBasicMaterial({
        map: makeFloorTex(FLOOR_POOL),
        fog: false
      });
      var floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(0, 0, 0);
      scene.add(floorMesh);
      var shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 26),
        new THREE.ShadowMaterial({ opacity: 0.4, fog: false })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = 0.002;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      var world = new CANNON.World();
      world.gravity.set(0, -GRAVITY, 0);
      world.broadphase = new CANNON.SAPBroadphase(world);
      world.allowSleep = true;
      world.solver.iterations = 8;
      world.defaultContactMaterial.friction = 0.5;
      world.defaultContactMaterial.restitution = 0.05;

      var floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      world.addBody(floorBody);

      var PALLET = { w: 1.24, d: 0.84, h: 0.144 };
      (function buildPallet() {
        var wood = new THREE.MeshStandardMaterial({ color: 0xa3835c, roughness: 0.9 });
        var woodDark = new THREE.MeshStandardMaterial({ color: 0x8c6f4c, roughness: 0.95 });
        var g = new THREE.Group();
        for (var i = 0; i < 5; i++) {
          var b = new THREE.Mesh(new THREE.BoxGeometry(PALLET.w, 0.022, 0.14), wood);
          b.position.set(0, PALLET.h - 0.011, -PALLET.d / 2 + 0.07 + i * (PALLET.d - 0.14) / 4);
          b.castShadow = b.receiveShadow = true;
          g.add(b);
        }
        for (var j = 0; j < 3; j++) {
          var s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, PALLET.d), woodDark);
          s.position.set(-PALLET.w / 2 + 0.05 + j * (PALLET.w - 0.1) / 2, PALLET.h - 0.022 - 0.045, 0);
          s.castShadow = s.receiveShadow = true;
          g.add(s);
        }
        for (var k = 0; k < 3; k++) {
          var bb = new THREE.Mesh(new THREE.BoxGeometry(PALLET.w, 0.022, 0.12), wood);
          bb.position.set(0, 0.011, -PALLET.d / 2 + 0.06 + k * (PALLET.d - 0.12) / 2);
          bb.castShadow = bb.receiveShadow = true;
          g.add(bb);
        }
        scene.add(g);
        var slab = new CANNON.Body({ mass: 0 });
        slab.addShape(new CANNON.Box(new CANNON.Vec3(PALLET.w / 2, PALLET.h / 2, PALLET.d / 2)));
        slab.position.set(0, PALLET.h / 2, 0);
        world.addBody(slab);
      })();

      function layerGrid(size, nx, nz, gapX, gapZ, y, skip) {
        var out = [];
        var pitchX = size[0] + gapX, pitchZ = size[2] + gapZ;
        var x0 = -pitchX * (nx - 1) / 2, z0 = -pitchZ * (nz - 1) / 2;
        var idx = 0;
        for (var ix = 0; ix < nx; ix++) for (var iz = 0; iz < nz; iz++, idx++) {
          if (skip && skip.indexOf(idx) !== -1) continue;
          out.push({ size: size, pos: [x0 + ix * pitchX, y, z0 + iz * pitchZ] });
        }
        return out;
      }

      var top = PALLET.h;
      var L1 = layerGrid([0.39, 0.34, 0.385], 3, 2, 0.012, 0.008, top + 0.17);
      var L2 = layerGrid([0.29, 0.27, 0.375], 4, 2, 0.010, 0.010, top + 0.34 + 0.135);
      var L3 = layerGrid([0.283, 0.235, 0.245], 4, 3, 0.008, 0.008, top + 0.61 + 0.1175);
      var L4 = layerGrid([0.185, 0.175, 0.18], 5, 3, 0.006, 0.006, top + 0.845 + 0.0875, [14]);
      var layers = coarsePointer ? [L1, L2, L3] : [L1, L2, L3, L4];

      var CARDBOARD_HUES = [0.085, 0.09, 0.095, 0.10];
      var boxes = [];
      var DYNAMIC = 0, SPRING = 1, KIN = 2;
      var tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
      var tmpV = new THREE.Vector3();

      layers.forEach(function (layer, li) {
        layer.forEach(function (spec) {
          var sx = spec.size[0], sy = spec.size[1], sz = spec.size[2];
          var jitter = function () { return (Math.random() - 0.5) * 0.006; };
          var px = spec.pos[0] + jitter(), py = spec.pos[1], pz = spec.pos[2] + jitter();

          var hue = CARDBOARD_HUES[(Math.random() * CARDBOARD_HUES.length) | 0];
          var color = new THREE.Color().setHSL(hue, 0.32 + Math.random() * 0.08, 0.52 + Math.random() * 0.1);
          var mesh = new THREE.Mesh(
            new THREE.BoxGeometry(sx, sy, sz),
            new THREE.MeshStandardMaterial({ color: color.clone(), emissive: 0x000000, roughness: 0.92 })
          );
          mesh.castShadow = mesh.receiveShadow = true;
          scene.add(mesh);

          var mass = Math.max(0.35, sx * sy * sz * 55);
          var body = new CANNON.Body({ mass: mass });
          body.addShape(new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)));
          body.position.set(px, py, pz);
          body.linearDamping = 0.08;
          body.angularDamping = 0.2;
          body.allowSleep = true;
          body.sleepSpeedLimit = 0.22;
          body.sleepTimeLimit = 0.45;
          world.addBody(body);
          body.sleep();

          boxes.push({
            body: body, mesh: mesh,
            halfExt: new CANNON.Vec3(sx / 2, sy / 2, sz / 2),
            halfDiag: 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz),
            home: { p: new CANNON.Vec3(px, py, pz), q: new THREE.Quaternion() },
            state: DYNAMIC,
            li: li,
            lastDisturbed: -1e9,
            delayR: Math.random(),
            returnT: 0,
            supports: [],
            cartonColor: color.clone(),
            color: { colored: false, sIdx: styleIndex, usePrimary: false }
          });
          mesh.position.copy(body.position);
        });
      });

      // ============================================================
      // COLOR ENGINE (verbatim)
      // ============================================================
      var BLACK = new THREE.Color(0, 0, 0);
      var tweens = new Map();
      function tweenMat(mat, toC, toE, dur) {
        if (reducedMotion) dur = 0;
        tweens.set(mat, {
          fromC: mat.color.clone(), toC: toC.clone(),
          fromE: mat.emissive.clone(), toE: toE.clone(),
          t0: performance.now(), dur: dur
        });
      }
      function stepTweens() {
        if (!tweens.size) return;
        var now = performance.now();
        tweens.forEach(function (tw, mat) {
          var p = tw.dur > 0 ? Math.min((now - tw.t0) / tw.dur, 1) : 1;
          var e = 1 - Math.pow(1 - p, 3);
          mat.color.copy(tw.fromC).lerp(tw.toC, e);
          mat.emissive.copy(tw.fromE).lerp(tw.toE, e);
          if (p >= 1) tweens.delete(mat);
        });
      }

      function pickRandom(arr, k) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
        return a.slice(0, Math.max(0, Math.min(k, a.length)));
      }

      function boxColor(sIdx, usePrimary) {
        var pair = STYLES[sIdx];
        return new THREE.Color(usePrimary ? pair.acc2 : pair.acc).convertSRGBToLinear();
      }
      function paint(b, sIdx) {
        b.color.colored = true;
        b.color.sIdx = sIdx;
        b.color.usePrimary = Math.random() < CONFIG.primaryShare;
        var c = boxColor(sIdx, b.color.usePrimary);
        tweenMat(b.mesh.material, c, c.clone().multiplyScalar(CONFIG.emissiveK), CONFIG.transitionMs);
      }
      function unpaint(b) {
        b.color.colored = false;
        tweenMat(b.mesh.material, b.cartonColor, BLACK, CONFIG.transitionMs);
      }

      function coloredBoxes() { return boxes.filter(function (b) { return b.color.colored; }); }
      function cartonBoxes()  { return boxes.filter(function (b) { return !b.color.colored; }); }

      function enforceCount() {
        var k = Math.round(boxes.length * CONFIG.coloredShare);
        var colored = coloredBoxes();
        if (colored.length < k) {
          pickRandom(cartonBoxes(), k - colored.length).forEach(function (b) { paint(b, styleIndex); });
        } else if (colored.length > k) {
          pickRandom(colored, colored.length - k).forEach(function (b) { unpaint(b); });
        }
      }

      function initColoring() {
        enforceCount();
        if (reducedMotion) { stepTweens(); renderStatic(); }
      }

      function onCycleColoring() {
        enforceCount();
        var k = Math.round(boxes.length * CONFIG.coloredShare);
        var churn = Math.round(k * CONFIG.reshuffleShare);
        var colored = coloredBoxes(), carton = cartonBoxes();
        var swap = Math.min(churn, colored.length, carton.length);
        if (swap > 0) {
          pickRandom(colored, swap).forEach(function (b) { unpaint(b); });
          pickRandom(carton,  swap).forEach(function (b) { paint(b, styleIndex); });
        }
        if (swap < churn) {
          pickRandom(coloredBoxes(), churn - swap).forEach(function (b) { paint(b, styleIndex); });
        }
        if (reducedMotion) { stepTweens(); renderStatic(); }
      }

      host._adoptStyle = function (i) {
        i = ((i % STYLES.length) + STYLES.length) % STYLES.length;
        if (i === styleIndex) return;
        styleIndex = i;
        onCycleColoring();
      };

      // ---------- cursor tracking ----------
      var raycaster = new THREE.Raycaster();
      var ndc = new THREE.Vector2();
      var pushPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
      var hitV = new THREE.Vector3(); // reused across events — no per-event allocation
      var cursor = {
        active: false, pressed: false, pressT: 0,
        pos: new THREE.Vector3(), prev: new THREE.Vector3(),
        vel: new THREE.Vector3(), speed: 0, hasPrev: false
      };

      function updateCursorFromEvent(e) {
        var r = canvas.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        if (raycaster.ray.intersectPlane(pushPlane, hitV)) {
          cursor.pos.copy(hitV);
          cursor.active = true;
        }
      }

      function clearCursor() {
        cursor.active = false; cursor.pressed = false;
        cursor.hasPrev = false; cursor.speed = 0; cursor.vel.set(0, 0, 0);
      }

      if (!reducedMotion) {
        canvas.addEventListener('pointermove', updateCursorFromEvent);
        canvas.addEventListener('pointerdown', function (e) {
          cursor.pressed = true; updateCursorFromEvent(e);
          cursor.pressT = performance.now();
          if (!coarsePointer) canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointerup', function () {
          cursor.pressed = false;
          var held = performance.now() - cursor.pressT;
          if (held < HOLD_MS && cursor.active) blast(cursor.pos);
        });
        canvas.addEventListener('pointercancel', clearCursor); // touch scroll took the gesture
        canvas.addEventListener('pointerleave', function () {
          cursor.active = false; cursor.hasPrev = false; cursor.speed = 0; cursor.vel.set(0, 0, 0);
        });
      }

      // ---------- interaction forces (locked constants) ----------
      var PUSH_RADIUS = 0.42;
      var SPEED_CAP = 8;
      var ATTRACT_RADIUS = 1.05;
      var PUSH_GAIN = 26;
      var HOLD_MS = 200;
      var BLAST_RADIUS = 1.75;
      var BLAST_SPEED = 8.5;
      var forceV = new CANNON.Vec3(), pointV = new CANNON.Vec3(), attractV = new CANNON.Vec3();

      function blast(at) {
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i], body = b.body;
          var dx = body.position.x - at.x;
          var dy = body.position.y - at.y;
          var dz = body.position.z - at.z;
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > BLAST_RADIUS + b.halfDiag) continue;
          if (b.state !== DYNAMIC) {
            if (!safeToMaterialize(b)) continue;
            cancelReturn(b);
          }
          body.wakeUp();
          b.lastDisturbed = clock.elapsedTime;
          var falloff = 1 - dist / (BLAST_RADIUS + b.halfDiag);
          var inv = dist > 1e-4 ? 1 / dist : 0;
          tmpV.set(dx * inv, dy * inv + 0.7, dz * inv).normalize();
          var s = BLAST_SPEED * falloff * falloff;
          forceV.set(tmpV.x * s * body.mass, tmpV.y * s * body.mass, tmpV.z * s * body.mass);
          pointV.set(
            body.position.x + (Math.random() - 0.5) * b.halfExt.x,
            body.position.y + (Math.random() - 0.5) * b.halfExt.y,
            body.position.z + (Math.random() - 0.5) * b.halfExt.z
          );
          body.applyImpulse(forceV, pointV);
        }
      }

      function applyCursorForces(dt, now) {
        if (!cursor.active) return;

        if (cursor.hasPrev) {
          tmpV.copy(cursor.pos).sub(cursor.prev).divideScalar(Math.max(dt, 1e-4));
          cursor.vel.lerp(tmpV, 0.35);
          cursor.speed = Math.min(cursor.vel.length(), SPEED_CAP);
        }
        cursor.prev.copy(cursor.pos);
        cursor.hasPrev = true;

        var holding = cursor.pressed && (performance.now() - cursor.pressT) > HOLD_MS;
        var attractPoint = null;
        if (holding) { attractV.set(cursor.pos.x, 1.05, cursor.pos.z); attractPoint = attractV; } // reused vec — no per-frame allocation

        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i], body = b.body;
          var dx = cursor.pos.x - body.position.x;
          var dy = cursor.pos.y - body.position.y;
          var dz = cursor.pos.z - body.position.z;
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (holding && attractPoint) {
            if (dist < ATTRACT_RADIUS) {
              if (b.state !== DYNAMIC) {
                if (!safeToMaterialize(b)) continue;
                cancelReturn(b);
              }
              body.wakeUp();
              b.lastDisturbed = now;
              forceV.set(
                (attractPoint.x - body.position.x) * 20 - body.velocity.x * 4,
                (attractPoint.y - body.position.y) * 20 - body.velocity.y * 4,
                (attractPoint.z - body.position.z) * 20 - body.velocity.z * 4
              );
              var maxF = body.mass * 55;
              var fLen = forceV.norm();
              if (fLen > maxF) forceV.scale(maxF / fLen, forceV);
              else forceV.scale(body.mass, forceV);
              body.applyForce(forceV, body.position);
            }
            continue;
          }

          var R = PUSH_RADIUS + b.halfDiag;
          if (dist < R) {
            if (b.state !== DYNAMIC) {
              if (!safeToMaterialize(b)) continue;
              cancelReturn(b);
            }
            b.lastDisturbed = now;
            if (cursor.speed > 0.15) {
              body.wakeUp();
              var falloff = 1 - dist / R;
              tmpV.copy(cursor.vel).normalize();
              tmpV.y = Math.max(tmpV.y, 0) + 0.12;
              tmpV.normalize();
              var mag = PUSH_GAIN * cursor.speed * falloff * body.mass;
              forceV.set(tmpV.x * mag, tmpV.y * mag, tmpV.z * mag);
              pointV.set(
                body.position.x + clamp(dx, -b.halfExt.x * 0.75, b.halfExt.x * 0.75),
                body.position.y + clamp(dy, -b.halfExt.y * 0.75, b.halfExt.y * 0.75),
                body.position.z + clamp(dz, -b.halfExt.z * 0.75, b.halfExt.z * 0.75)
              );
              body.applyForce(forceV, pointV);
            }
          }
        }
      }

      function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

      // ---------- return system (verbatim) ----------
      function cancelReturn(b) {
        b.state = DYNAMIC;
        b.body.type = CANNON.Body.DYNAMIC;
        b.body.collisionResponse = true;
        b.body.allowSleep = true;
        b.body.wakeUp();
      }

      function safeToMaterialize(b) {
        if (b.state !== KIN) return true;
        for (var i = 0; i < boxes.length; i++) {
          var o = boxes[i];
          if (o === b || o.state === KIN) continue;
          if (b.body.position.distanceTo(o.body.position) < (b.halfDiag + o.halfDiag) * 0.75) return false;
        }
        return true;
      }

      function beginSpring(b) {
        b.state = SPRING; b.returnT = 0;
        b.body.type = CANNON.Body.DYNAMIC;
        b.body.allowSleep = false;
        b.body.wakeUp();
      }
      function beginGhost(b) {
        b.state = KIN;
        b.appr = null; b.apprDone = false;
        b.body.type = CANNON.Body.KINEMATIC;
        b.body.collisionResponse = false;
        b.body.allowSleep = false;
        b.body.wakeUp();
        b.body.velocity.set(0, 0, 0);
        b.body.angularVelocity.set(0, 0, 0);
      }
      function seat(b) {
        var body = b.body;
        body.position.copy(b.home.p);
        body.quaternion.set(b.home.q.x, b.home.q.y, b.home.q.z, b.home.q.w);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        body.type = CANNON.Body.DYNAMIC;
        body.collisionResponse = true;
        body.allowSleep = true;
        b.state = DYNAMIC;
        b.lastDisturbed = -1e9;
        b.appr = null; b.apprDone = false;
        body.sleep();
      }

      function isDisplaced(b) {
        var dp = b.body.position.distanceTo(b.home.p);
        tmpQ.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w);
        return dp > 0.03 || Math.abs(tmpQ.dot(b.home.q)) <= 0.9995;
      }
      function isSeated(b) {
        if (b.state !== DYNAMIC) return false;
        var dp = b.body.position.distanceTo(b.home.p);
        tmpQ.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w);
        return dp < 0.03 && Math.abs(tmpQ.dot(b.home.q)) > 0.9995;
      }

      function computeSupports() {
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i];
          if (b.li === 0) continue;
          for (var j = 0; j < boxes.length; j++) {
            var u = boxes[j];
            if (u.li !== b.li - 1) continue;
            if (Math.abs(u.home.p.x - b.home.p.x) < u.halfExt.x + b.halfExt.x - 0.01 &&
                Math.abs(u.home.p.z - b.home.p.z) < u.halfExt.z + b.halfExt.z - 0.01) {
              b.supports.push(j);
            }
          }
        }
      }

      function returnDelayOf(b) {
        return 0.35 + b.delayR * 0.3;
      }
      function orderGateOpen(b) {
        if (b.li === 0) return true;
        for (var i = 0; i < b.supports.length; i++) {
          if (!isSeated(boxes[b.supports[i]])) return false;
        }
        return true;
      }

      function ghostTarget(b) {
        var p = b.body.position, h = b.home.p;
        var dx = p.x - h.x, dz = p.z - h.z;
        var horiz = Math.sqrt(dx * dx + dz * dz);
        if (!b.appr) {
          if (horiz < 0.15) return h;
          var ad = Math.min(CONFIG.riseOffset, horiz);
          var inv = 1 / horiz;
          b.appr = { x: h.x + dx * inv * ad, y: h.y, z: h.z + dz * inv * ad };
        }
        if (!b.apprDone) {
          var ax = p.x - b.appr.x, ay = p.y - b.appr.y, az = p.z - b.appr.z;
          if (Math.sqrt(ax * ax + ay * ay + az * az) < 0.12) b.apprDone = true;
          else return b.appr;
        }
        return h;
      }

      function updateReturns(dt, now) {
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i], body = b.body;

          if (b.state === DYNAMIC) {
            var speed = body.velocity.norm();
            if (speed > 0.3) b.lastDisturbed = now;
            if (isDisplaced(b) &&
                now - b.lastDisturbed > returnDelayOf(b) && orderGateOpen(b)) {
              if (body.position.distanceTo(b.home.p) < CONFIG.ghostAt) beginGhost(b);
              else beginSpring(b);
            }
            continue;
          }

          if (b.state === SPRING) {
            b.returnT += dt;
            var ramp = Math.min(b.returnT / 1.1, 1);
            var kS = 20 + 120 * ramp * ramp;
            var cS = 2 * Math.sqrt(kS) * 1.05;
            var ax2 = (b.home.p.x - body.position.x) * kS - body.velocity.x * cS;
            var ay2 = (b.home.p.y - body.position.y) * kS - body.velocity.y * cS + GRAVITY;
            var az2 = (b.home.p.z - body.position.z) * kS - body.velocity.z * cS;
            var aLen = Math.sqrt(ax2 * ax2 + ay2 * ay2 + az2 * az2);
            var A_MAX = 55;
            if (aLen > A_MAX) { var sA = A_MAX / aLen; ax2 *= sA; ay2 *= sA; az2 *= sA; }
            forceV.set(ax2 * body.mass, ay2 * body.mass, az2 * body.mass);
            body.applyForce(forceV, body.position);

            tmpQ.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
            if (body.position.distanceTo(b.home.p) < 0.02 &&
                Math.abs(tmpQ.dot(b.home.q)) > 0.9998 && body.velocity.norm() < 0.35) { seat(b); continue; }

            if (body.position.distanceTo(b.home.p) < CONFIG.ghostAt ||
                b.returnT > CONFIG.springTimeout) beginGhost(b);
            continue;
          }

          var tgt = ghostTarget(b);
          var alpha = 1 - Math.exp(-3.2 * dt);
          body.position.set(
            body.position.x + (tgt.x - body.position.x) * alpha,
            body.position.y + (tgt.y - body.position.y) * alpha,
            body.position.z + (tgt.z - body.position.z) * alpha
          );
          body.velocity.set(0, 0, 0);

          tmpQ.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
          tmpQ.slerp(b.home.q, alpha);
          body.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
          body.angularVelocity.set(0, 0, 0);

          tmpQ2.copy(b.home.q);
          if (body.position.distanceTo(b.home.p) < 0.012 && Math.abs(tmpQ.dot(tmpQ2)) > 0.99995) seat(b);
        }
      }

      // ---------- element-scoped resize ----------
      function resize() {
        var w = host.offsetWidth || window.innerWidth;
        var h = host.offsetHeight || window.innerHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (reducedMotion) renderStatic();
      }
      if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
      else window.addEventListener('resize', resize);

      // ---------- main loop, gated on visibility ----------
      var clock = new THREE.Clock();
      var visible = true;
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
        }, { threshold: 0.01 }).observe(host);
      }

      function syncMeshes() {
        for (var i = 0; i < boxes.length; i++) {
          boxes[i].mesh.position.copy(boxes[i].body.position);
          boxes[i].mesh.quaternion.copy(boxes[i].body.quaternion);
        }
      }
      function renderStatic() { syncMeshes(); renderer.render(scene, camera); }

      function tick() {
        if (host._dead) { window.__fsTicker.remove(tick); return; }
        if (!visible || host._paused || document.hidden) { clock.getDelta(); return; }
        var dt = Math.min(clock.getDelta(), 1 / 20);
        var now = clock.elapsedTime;

        applyCursorForces(dt, now);
        world.step(1 / 60, dt, 3);
        updateReturns(dt, now);
        syncMeshes();
        stepTweens();

        camera.position.set(
          camBase.x + Math.sin(now * 0.18) * 0.09,
          camBase.y + Math.sin(now * 0.13 + 1.7) * 0.05,
          camBase.z + Math.cos(now * 0.15) * 0.09
        );
        camera.lookAt(camTarget);

        renderer.render(scene, camera);
      }

      // ---------- boot ----------
      computeSupports();
      initColoring();
      resize();
      if (reducedMotion) {
        stepTweens();
        renderStatic();
      } else {
        window.__fsTicker.add(tick);
      }
    }
  }

  if (!customElements.get('pallet-hero')) customElements.define('pallet-hero', PalletHero);
})();
