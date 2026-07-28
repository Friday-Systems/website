/* <pallet-hero> — Friday Systems interactive pallet hero.
   Port of the validated pallet-spike: all physics constants, interaction
   thresholds, return-system config and the color system are verbatim.
   Integration layer only: element-scoped sizing, page-driven color sync
   (style-index attribute), touch-action pan-y, visibility-gated loop.

   Build-phase changes vs the design prototype (behavior-preserving):
   - CDN three.js r128 / cannon.js 0.6.2 replaced with pinned npm deps
     (three@0.128.0, cannon-es). cannon-es takes applyForce/applyImpulse
     points RELATIVE to the body's center of mass (cannon.js took world
     points), so the call sites below pass the same offsets pre-subtracted —
     the resulting physics are identical. Vec3#norm() is Vec3#length().
   - The desktop and mobile forks are merged: device tier (IS_TOUCH — coarse
     pointer) selects HOLD_MS 280 vs 200, DPR cap 1.5 vs 2, shadow map 1024
     vs 2048, 3 vs 4 stack layers, and the portrait camera dolly-out. */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { getTicker, IS_TOUCH } from '../ticker';

class PalletHero extends HTMLElement {
  _booted = false;
  _dead = false;
  _paused = false;
  _extIdx: number | null = null;
  _canvas!: HTMLCanvasElement;
  _adoptStyle: ((i: number) => void) | null = null;

  // External color sync: the page owns the theme and sets style-index="N"
  // (same 4-style order as the spike); every change repaints the box quota.
  static get observedAttributes() {
    return ['style-index'];
  }
  attributeChangedCallback(name: string, _oldV: string | null, newV: string | null) {
    if (name !== 'style-index' || newV == null) return;
    const i = parseInt(newV, 10);
    if (isNaN(i)) return;
    this._extIdx = i;
    if (this._adoptStyle) this._adoptStyle(i);
  }

  // page-driven sim gate: set while the hero scene is occluded (mirrors spray-current)
  get paused() {
    return !!this._paused;
  }
  set paused(v: boolean) {
    this._paused = !!v;
  }

  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.height = '100%';
    if (getComputedStyle(this).position === 'static') this.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1;touch-action:pan-y;cursor:crosshair;';
    this.appendChild(canvas);
    this._canvas = canvas;
    this._start();
  }

  disconnectedCallback() {
    this._dead = true;
  }

  _start() {
    const host = this;
    const canvas = this._canvas;

    // ============================================================
    // CONFIG — locked (validated spike values)
    // ============================================================
    const CONFIG = {
      coloredShare: 0.5,
      reshuffleShare: 0.7,
      primaryShare: 0.5,
      emissiveK: 0.22,
      transitionMs: 240,
      ghostAt: 0.8,
      riseOffset: 1.2,
      springTimeout: 4.0,
    };

    const STYLES = [
      { name: 'cyan', acc: '#35D0DB', acc2: '#4D5FE0' },
      { name: 'coral', acc: '#FF6762', acc2: '#D72F92' },
      { name: 'lime', acc: '#92D36C', acc2: '#00BAA2' },
      { name: 'fuchsia', acc: '#E852E0', acc2: '#764BE5' },
    ];
    let styleIndex = (Math.random() * STYLES.length) | 0;
    if (host._extIdx != null) styleIndex = ((host._extIdx % STYLES.length) + STYLES.length) % STYLES.length;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = IS_TOUCH;

    const GRAVITY = 9.82;
    const PAGE_BG = '#090B1A'; // must match the page --navy-deep

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.Fog(PAGE_BG, 9, 20);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    const camBase = new THREE.Vector3(2.9, 2.15, 3.55);
    const camTarget = new THREE.Vector3(0, 0.55, 0);
    camera.position.copy(camBase);
    camera.lookAt(camTarget);
    let camScale = 1; // portrait dolly-out factor (touch tier), set in resize()

    scene.add(new THREE.HemisphereLight(0xc7ccea, 0x0b0d1c, 0.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.95);
    sun.position.set(3.5, 6.5, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(coarsePointer ? 1024 : 2048, coarsePointer ? 1024 : 2048);
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 14;
    sun.shadow.bias = -0.0015;
    scene.add(sun);

    // real floor: unlit gradient texture (exact colors, no light wash) —
    // a lit pool near/under the pallet dissolving to #090B1A (the page bg)
    // far out, so the plane has no visible edge.
    const FLOOR_FAR = PAGE_BG;
    const FLOOR_POOL = { near: '#1A2142', radius: 300 };
    function mixHex(a: string, b: string, t: number) {
      const pa = parseInt(a.slice(1), 16),
        pb = parseInt(b.slice(1), 16);
      const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
      const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
      const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
      return 'rgb(' + r + ',' + g + ',' + bl + ')';
    }
    function makeFloorTex(v: { near: string; radius: number }) {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = FLOOR_FAR;
      ctx.fillRect(0, 0, 1024, 1024);
      const g = ctx.createRadialGradient(512, 512, 0, 512, 512, v.radius);
      g.addColorStop(0, v.near);
      g.addColorStop(0.55, mixHex(v.near, FLOOR_FAR, 0.55));
      g.addColorStop(1, FLOOR_FAR);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 1024);
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    }
    const floorMat = new THREE.MeshBasicMaterial({
      map: makeFloorTex(FLOOR_POOL),
      fog: false,
    });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0);
    scene.add(floorMesh);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.ShadowMaterial({ opacity: 0.4, fog: false } as any)
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.002;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const world = new CANNON.World();
    world.gravity.set(0, -GRAVITY, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    (world.solver as CANNON.GSSolver).iterations = 8;
    world.defaultContactMaterial.friction = 0.5;
    world.defaultContactMaterial.restitution = 0.05;

    const floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(floorBody);

    const PALLET = { w: 1.24, d: 0.84, h: 0.144 };
    (function buildPallet() {
      const wood = new THREE.MeshStandardMaterial({ color: 0xa3835c, roughness: 0.9 });
      const woodDark = new THREE.MeshStandardMaterial({ color: 0x8c6f4c, roughness: 0.95 });
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(PALLET.w, 0.022, 0.14), wood);
        b.position.set(0, PALLET.h - 0.011, -PALLET.d / 2 + 0.07 + (i * (PALLET.d - 0.14)) / 4);
        b.castShadow = b.receiveShadow = true;
        g.add(b);
      }
      for (let j = 0; j < 3; j++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, PALLET.d), woodDark);
        s.position.set(-PALLET.w / 2 + 0.05 + (j * (PALLET.w - 0.1)) / 2, PALLET.h - 0.022 - 0.045, 0);
        s.castShadow = s.receiveShadow = true;
        g.add(s);
      }
      for (let k = 0; k < 3; k++) {
        const bb = new THREE.Mesh(new THREE.BoxGeometry(PALLET.w, 0.022, 0.12), wood);
        bb.position.set(0, 0.011, -PALLET.d / 2 + 0.06 + (k * (PALLET.d - 0.12)) / 2);
        bb.castShadow = bb.receiveShadow = true;
        g.add(bb);
      }
      scene.add(g);
      const slab = new CANNON.Body({ mass: 0 });
      slab.addShape(new CANNON.Box(new CANNON.Vec3(PALLET.w / 2, PALLET.h / 2, PALLET.d / 2)));
      slab.position.set(0, PALLET.h / 2, 0);
      world.addBody(slab);
    })();

    function layerGrid(
      size: number[],
      nx: number,
      nz: number,
      gapX: number,
      gapZ: number,
      y: number,
      skip?: number[]
    ) {
      const out: { size: number[]; pos: number[] }[] = [];
      const pitchX = size[0] + gapX,
        pitchZ = size[2] + gapZ;
      const x0 = (-pitchX * (nx - 1)) / 2,
        z0 = (-pitchZ * (nz - 1)) / 2;
      let idx = 0;
      for (let ix = 0; ix < nx; ix++)
        for (let iz = 0; iz < nz; iz++, idx++) {
          if (skip && skip.indexOf(idx) !== -1) continue;
          out.push({ size: size, pos: [x0 + ix * pitchX, y, z0 + iz * pitchZ] });
        }
      return out;
    }

    const top = PALLET.h;
    const L1 = layerGrid([0.39, 0.34, 0.385], 3, 2, 0.012, 0.008, top + 0.17);
    const L2 = layerGrid([0.29, 0.27, 0.375], 4, 2, 0.01, 0.01, top + 0.34 + 0.135);
    const L3 = layerGrid([0.283, 0.235, 0.245], 4, 3, 0.008, 0.008, top + 0.61 + 0.1175);
    const L4 = layerGrid([0.185, 0.175, 0.18], 5, 3, 0.006, 0.006, top + 0.845 + 0.0875, [14]);
    const layers = coarsePointer ? [L1, L2, L3] : [L1, L2, L3, L4];

    const CARDBOARD_HUES = [0.085, 0.09, 0.095, 0.1];
    interface BoxRec {
      body: CANNON.Body;
      mesh: THREE.Mesh;
      halfExt: CANNON.Vec3;
      halfDiag: number;
      home: { p: CANNON.Vec3; q: THREE.Quaternion };
      state: number;
      li: number;
      lastDisturbed: number;
      delayR: number;
      returnT: number;
      supports: number[];
      cartonColor: THREE.Color;
      color: { colored: boolean; sIdx: number; usePrimary: boolean };
      appr?: { x: number; y: number; z: number } | null;
      apprDone?: boolean;
    }
    const boxes: BoxRec[] = [];
    const DYNAMIC = 0,
      SPRING = 1,
      KIN = 2;
    const tmpQ = new THREE.Quaternion(),
      tmpQ2 = new THREE.Quaternion();
    const tmpV = new THREE.Vector3();

    layers.forEach(function (layer, li) {
      layer.forEach(function (spec) {
        const sx = spec.size[0],
          sy = spec.size[1],
          sz = spec.size[2];
        const jitter = function () {
          return (Math.random() - 0.5) * 0.006;
        };
        const px = spec.pos[0] + jitter(),
          py = spec.pos[1],
          pz = spec.pos[2] + jitter();

        const hue = CARDBOARD_HUES[(Math.random() * CARDBOARD_HUES.length) | 0];
        const color = new THREE.Color().setHSL(hue, 0.32 + Math.random() * 0.08, 0.52 + Math.random() * 0.1);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(sx, sy, sz),
          new THREE.MeshStandardMaterial({ color: color.clone(), emissive: 0x000000, roughness: 0.92 })
        );
        mesh.castShadow = mesh.receiveShadow = true;
        scene.add(mesh);

        const mass = Math.max(0.35, sx * sy * sz * 55);
        const body = new CANNON.Body({ mass: mass });
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
          body: body,
          mesh: mesh,
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
          color: { colored: false, sIdx: styleIndex, usePrimary: false },
        });
        mesh.position.copy(body.position as unknown as THREE.Vector3);
      });
    });

    // ============================================================
    // COLOR ENGINE (verbatim)
    // ============================================================
    const BLACK = new THREE.Color(0, 0, 0);
    const tweens = new Map<
      THREE.MeshStandardMaterial,
      { fromC: THREE.Color; toC: THREE.Color; fromE: THREE.Color; toE: THREE.Color; t0: number; dur: number }
    >();
    function tweenMat(mat: THREE.MeshStandardMaterial, toC: THREE.Color, toE: THREE.Color, dur: number) {
      if (reducedMotion) dur = 0;
      tweens.set(mat, {
        fromC: mat.color.clone(),
        toC: toC.clone(),
        fromE: mat.emissive.clone(),
        toE: toE.clone(),
        t0: performance.now(),
        dur: dur,
      });
    }
    function stepTweens() {
      if (!tweens.size) return;
      const now = performance.now();
      tweens.forEach(function (tw, mat) {
        const p = tw.dur > 0 ? Math.min((now - tw.t0) / tw.dur, 1) : 1;
        const e = 1 - Math.pow(1 - p, 3);
        mat.color.copy(tw.fromC).lerp(tw.toC, e);
        mat.emissive.copy(tw.fromE).lerp(tw.toE, e);
        if (p >= 1) tweens.delete(mat);
      });
    }

    function pickRandom<T>(arr: T[], k: number): T[] {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a.slice(0, Math.max(0, Math.min(k, a.length)));
    }

    function boxColor(sIdx: number, usePrimary: boolean) {
      const pair = STYLES[sIdx];
      return new THREE.Color(usePrimary ? pair.acc2 : pair.acc).convertSRGBToLinear();
    }
    function paint(b: BoxRec, sIdx: number) {
      b.color.colored = true;
      b.color.sIdx = sIdx;
      b.color.usePrimary = Math.random() < CONFIG.primaryShare;
      const c = boxColor(sIdx, b.color.usePrimary);
      tweenMat(
        b.mesh.material as THREE.MeshStandardMaterial,
        c,
        c.clone().multiplyScalar(CONFIG.emissiveK),
        CONFIG.transitionMs
      );
    }
    function unpaint(b: BoxRec) {
      b.color.colored = false;
      tweenMat(b.mesh.material as THREE.MeshStandardMaterial, b.cartonColor, BLACK, CONFIG.transitionMs);
    }

    function coloredBoxes() {
      return boxes.filter(function (b) {
        return b.color.colored;
      });
    }
    function cartonBoxes() {
      return boxes.filter(function (b) {
        return !b.color.colored;
      });
    }

    function enforceCount() {
      const k = Math.round(boxes.length * CONFIG.coloredShare);
      const colored = coloredBoxes();
      if (colored.length < k) {
        pickRandom(cartonBoxes(), k - colored.length).forEach(function (b) {
          paint(b, styleIndex);
        });
      } else if (colored.length > k) {
        pickRandom(colored, colored.length - k).forEach(function (b) {
          unpaint(b);
        });
      }
    }

    function initColoring() {
      enforceCount();
      if (reducedMotion) {
        stepTweens();
        renderStatic();
      }
    }

    function onCycleColoring() {
      enforceCount();
      const k = Math.round(boxes.length * CONFIG.coloredShare);
      const churn = Math.round(k * CONFIG.reshuffleShare);
      const colored = coloredBoxes(),
        carton = cartonBoxes();
      const swap = Math.min(churn, colored.length, carton.length);
      if (swap > 0) {
        pickRandom(colored, swap).forEach(function (b) {
          unpaint(b);
        });
        pickRandom(carton, swap).forEach(function (b) {
          paint(b, styleIndex);
        });
      }
      if (swap < churn) {
        pickRandom(coloredBoxes(), churn - swap).forEach(function (b) {
          paint(b, styleIndex);
        });
      }
      if (reducedMotion) {
        stepTweens();
        renderStatic();
      }
    }

    host._adoptStyle = function (i: number) {
      i = ((i % STYLES.length) + STYLES.length) % STYLES.length;
      if (i === styleIndex) return;
      styleIndex = i;
      onCycleColoring();
    };

    // ---------- cursor tracking ----------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pushPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
    const hitV = new THREE.Vector3(); // reused across events — no per-event allocation
    const cursor = {
      active: false,
      pressed: false,
      pressT: 0,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      speed: 0,
      hasPrev: false,
    };

    function updateCursorFromEvent(e: PointerEvent) {
      const r = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(pushPlane, hitV)) {
        cursor.pos.copy(hitV);
        cursor.active = true;
      }
    }

    function clearCursor() {
      cursor.active = false;
      cursor.pressed = false;
      cursor.hasPrev = false;
      cursor.speed = 0;
      cursor.vel.set(0, 0, 0);
    }

    if (!reducedMotion) {
      canvas.addEventListener('pointermove', updateCursorFromEvent);
      canvas.addEventListener('pointerdown', function (e) {
        cursor.pressed = true;
        updateCursorFromEvent(e);
        cursor.pressT = performance.now();
        if (!coarsePointer) canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointerup', function () {
        cursor.pressed = false;
        const held = performance.now() - cursor.pressT;
        if (held < HOLD_MS && cursor.active) blast(cursor.pos);
      });
      canvas.addEventListener('pointercancel', clearCursor); // touch scroll took the gesture
      canvas.addEventListener('pointerleave', function () {
        cursor.active = false;
        cursor.hasPrev = false;
        cursor.speed = 0;
        cursor.vel.set(0, 0, 0);
      });
    }

    // ---------- interaction forces (locked constants) ----------
    const PUSH_RADIUS = 0.42;
    const SPEED_CAP = 8;
    const ATTRACT_RADIUS = 1.05;
    const PUSH_GAIN = 26;
    const HOLD_MS = coarsePointer ? 280 : 200; // touch: scroll-flick touchdowns must never read as holds
    const BLAST_RADIUS = 1.75;
    const BLAST_SPEED = 8.5;
    const forceV = new CANNON.Vec3(),
      pointV = new CANNON.Vec3(),
      attractV = new CANNON.Vec3();

    function blast(at: THREE.Vector3) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i],
          body = b.body;
        const dx = body.position.x - at.x;
        const dy = body.position.y - at.y;
        const dz = body.position.z - at.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > BLAST_RADIUS + b.halfDiag) continue;
        if (b.state !== DYNAMIC) {
          if (!safeToMaterialize(b)) continue;
          cancelReturn(b);
        }
        body.wakeUp();
        b.lastDisturbed = clock.elapsedTime;
        const falloff = 1 - dist / (BLAST_RADIUS + b.halfDiag);
        const inv = dist > 1e-4 ? 1 / dist : 0;
        tmpV.set(dx * inv, dy * inv + 0.7, dz * inv).normalize();
        const s = BLAST_SPEED * falloff * falloff;
        forceV.set(tmpV.x * s * body.mass, tmpV.y * s * body.mass, tmpV.z * s * body.mass);
        // cannon-es: impulse point is relative to the center of mass
        pointV.set(
          (Math.random() - 0.5) * b.halfExt.x,
          (Math.random() - 0.5) * b.halfExt.y,
          (Math.random() - 0.5) * b.halfExt.z
        );
        body.applyImpulse(forceV, pointV);
      }
    }

    function applyCursorForces(dt: number, now: number) {
      if (!cursor.active) return;

      if (cursor.hasPrev) {
        tmpV.copy(cursor.pos).sub(cursor.prev).divideScalar(Math.max(dt, 1e-4));
        cursor.vel.lerp(tmpV, 0.35);
        cursor.speed = Math.min(cursor.vel.length(), SPEED_CAP);
      }
      cursor.prev.copy(cursor.pos);
      cursor.hasPrev = true;

      const holding = cursor.pressed && performance.now() - cursor.pressT > HOLD_MS;
      let attractPoint: CANNON.Vec3 | null = null;
      if (holding) {
        attractV.set(cursor.pos.x, 1.05, cursor.pos.z);
        attractPoint = attractV;
      } // reused vec — no per-frame allocation

      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i],
          body = b.body;
        const dx = cursor.pos.x - body.position.x;
        const dy = cursor.pos.y - body.position.y;
        const dz = cursor.pos.z - body.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

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
            const maxF = body.mass * 55;
            const fLen = forceV.length();
            if (fLen > maxF) forceV.scale(maxF / fLen, forceV);
            else forceV.scale(body.mass, forceV);
            body.applyForce(forceV); // at center of mass (cannon-es relative zero)
          }
          continue;
        }

        const R = PUSH_RADIUS + b.halfDiag;
        if (dist < R) {
          if (b.state !== DYNAMIC) {
            if (!safeToMaterialize(b)) continue;
            cancelReturn(b);
          }
          b.lastDisturbed = now;
          if (cursor.speed > 0.15) {
            body.wakeUp();
            const falloff = 1 - dist / R;
            tmpV.copy(cursor.vel).normalize();
            tmpV.y = Math.max(tmpV.y, 0) + 0.12;
            tmpV.normalize();
            const mag = PUSH_GAIN * cursor.speed * falloff * body.mass;
            forceV.set(tmpV.x * mag, tmpV.y * mag, tmpV.z * mag);
            // cannon-es: force point is relative to the center of mass
            pointV.set(
              clamp(dx, -b.halfExt.x * 0.75, b.halfExt.x * 0.75),
              clamp(dy, -b.halfExt.y * 0.75, b.halfExt.y * 0.75),
              clamp(dz, -b.halfExt.z * 0.75, b.halfExt.z * 0.75)
            );
            body.applyForce(forceV, pointV);
          }
        }
      }
    }

    function clamp(v: number, lo: number, hi: number) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    // ---------- return system (verbatim) ----------
    function cancelReturn(b: BoxRec) {
      b.state = DYNAMIC;
      b.body.type = CANNON.Body.DYNAMIC;
      b.body.collisionResponse = true;
      b.body.allowSleep = true;
      b.body.wakeUp();
    }

    function safeToMaterialize(b: BoxRec) {
      if (b.state !== KIN) return true;
      for (let i = 0; i < boxes.length; i++) {
        const o = boxes[i];
        if (o === b || o.state === KIN) continue;
        if (b.body.position.distanceTo(o.body.position) < (b.halfDiag + o.halfDiag) * 0.75) return false;
      }
      return true;
    }

    function beginSpring(b: BoxRec) {
      b.state = SPRING;
      b.returnT = 0;
      b.body.type = CANNON.Body.DYNAMIC;
      b.body.allowSleep = false;
      b.body.wakeUp();
    }
    function beginGhost(b: BoxRec) {
      b.state = KIN;
      b.appr = null;
      b.apprDone = false;
      b.body.type = CANNON.Body.KINEMATIC;
      b.body.collisionResponse = false;
      b.body.allowSleep = false;
      b.body.wakeUp();
      b.body.velocity.set(0, 0, 0);
      b.body.angularVelocity.set(0, 0, 0);
    }
    function seat(b: BoxRec) {
      const body = b.body;
      body.position.copy(b.home.p);
      body.quaternion.set(b.home.q.x, b.home.q.y, b.home.q.z, b.home.q.w);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.type = CANNON.Body.DYNAMIC;
      body.collisionResponse = true;
      body.allowSleep = true;
      b.state = DYNAMIC;
      b.lastDisturbed = -1e9;
      b.appr = null;
      b.apprDone = false;
      body.sleep();
    }

    function isDisplaced(b: BoxRec) {
      const dp = b.body.position.distanceTo(b.home.p);
      tmpQ.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w);
      return dp > 0.03 || Math.abs(tmpQ.dot(b.home.q)) <= 0.9995;
    }
    function isSeated(b: BoxRec) {
      if (b.state !== DYNAMIC) return false;
      const dp = b.body.position.distanceTo(b.home.p);
      tmpQ.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w);
      return dp < 0.03 && Math.abs(tmpQ.dot(b.home.q)) > 0.9995;
    }

    function computeSupports() {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.li === 0) continue;
        for (let j = 0; j < boxes.length; j++) {
          const u = boxes[j];
          if (u.li !== b.li - 1) continue;
          if (
            Math.abs(u.home.p.x - b.home.p.x) < u.halfExt.x + b.halfExt.x - 0.01 &&
            Math.abs(u.home.p.z - b.home.p.z) < u.halfExt.z + b.halfExt.z - 0.01
          ) {
            b.supports.push(j);
          }
        }
      }
    }

    function returnDelayOf(b: BoxRec) {
      return 0.35 + b.delayR * 0.3;
    }
    function orderGateOpen(b: BoxRec) {
      if (b.li === 0) return true;
      for (let i = 0; i < b.supports.length; i++) {
        if (!isSeated(boxes[b.supports[i]])) return false;
      }
      return true;
    }

    function ghostTarget(b: BoxRec) {
      const p = b.body.position,
        h = b.home.p;
      const dx = p.x - h.x,
        dz = p.z - h.z;
      const horiz = Math.sqrt(dx * dx + dz * dz);
      if (!b.appr) {
        if (horiz < 0.15) return h;
        const ad = Math.min(CONFIG.riseOffset, horiz);
        const inv = 1 / horiz;
        b.appr = { x: h.x + dx * inv * ad, y: h.y, z: h.z + dz * inv * ad };
      }
      if (!b.apprDone) {
        const ax = p.x - b.appr.x,
          ay = p.y - b.appr.y,
          az = p.z - b.appr.z;
        if (Math.sqrt(ax * ax + ay * ay + az * az) < 0.12) b.apprDone = true;
        else return b.appr;
      }
      return h;
    }

    function updateReturns(dt: number, now: number) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i],
          body = b.body;

        if (b.state === DYNAMIC) {
          const speed = body.velocity.length();
          if (speed > 0.3) b.lastDisturbed = now;
          if (isDisplaced(b) && now - b.lastDisturbed > returnDelayOf(b) && orderGateOpen(b)) {
            if (body.position.distanceTo(b.home.p) < CONFIG.ghostAt) beginGhost(b);
            else beginSpring(b);
          }
          continue;
        }

        if (b.state === SPRING) {
          b.returnT += dt;
          const ramp = Math.min(b.returnT / 1.1, 1);
          const kS = 20 + 120 * ramp * ramp;
          const cS = 2 * Math.sqrt(kS) * 1.05;
          let ax2 = (b.home.p.x - body.position.x) * kS - body.velocity.x * cS;
          let ay2 = (b.home.p.y - body.position.y) * kS - body.velocity.y * cS + GRAVITY;
          let az2 = (b.home.p.z - body.position.z) * kS - body.velocity.z * cS;
          const aLen = Math.sqrt(ax2 * ax2 + ay2 * ay2 + az2 * az2);
          const A_MAX = 55;
          if (aLen > A_MAX) {
            const sA = A_MAX / aLen;
            ax2 *= sA;
            ay2 *= sA;
            az2 *= sA;
          }
          forceV.set(ax2 * body.mass, ay2 * body.mass, az2 * body.mass);
          body.applyForce(forceV); // at center of mass (cannon-es relative zero)

          tmpQ.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
          if (
            body.position.distanceTo(b.home.p) < 0.02 &&
            Math.abs(tmpQ.dot(b.home.q)) > 0.9998 &&
            body.velocity.length() < 0.35
          ) {
            seat(b);
            continue;
          }

          if (body.position.distanceTo(b.home.p) < CONFIG.ghostAt || b.returnT > CONFIG.springTimeout)
            beginGhost(b);
          continue;
        }

        const tgt = ghostTarget(b);
        const alpha = 1 - Math.exp(-3.2 * dt);
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
      const w = host.offsetWidth || window.innerWidth;
      const h = host.offsetHeight || window.innerHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // portrait framing (touch tier): dolly out so the full stack + scatter
      // radius fits the tall frame — camera moves, physics and box scale
      // untouched (boxes stay readable)
      camScale = coarsePointer && camera.aspect < 1 ? Math.min(1.8, 1 + (1 - camera.aspect) * 0.85) : 1;
      camera.position.set(camBase.x * camScale, camBase.y * camScale, camBase.z * camScale);
      camera.lookAt(camTarget);
      if (reducedMotion) renderStatic();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);

    // ---------- main loop, gated on visibility ----------
    const clock = new THREE.Clock();
    let visible = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(
        function (entries) {
          visible = entries[0].isIntersecting;
        },
        { threshold: 0.01 }
      ).observe(host);
    }

    function syncMeshes() {
      for (let i = 0; i < boxes.length; i++) {
        boxes[i].mesh.position.copy(boxes[i].body.position as unknown as THREE.Vector3);
        boxes[i].mesh.quaternion.copy(boxes[i].body.quaternion as unknown as THREE.Quaternion);
      }
    }
    function renderStatic() {
      syncMeshes();
      renderer.render(scene, camera);
    }

    function tick() {
      if (host._dead) {
        getTicker().remove(tick);
        return;
      }
      if (!visible || host._paused || document.hidden) {
        clock.getDelta();
        return;
      }
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const now = clock.elapsedTime;

      applyCursorForces(dt, now);
      world.step(1 / 60, dt, 3);
      updateReturns(dt, now);
      syncMeshes();
      stepTweens();

      camera.position.set(
        camBase.x * camScale + Math.sin(now * 0.18) * 0.09,
        camBase.y * camScale + Math.sin(now * 0.13 + 1.7) * 0.05,
        camBase.z * camScale + Math.cos(now * 0.15) * 0.09
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
      getTicker().add(tick);
    }
  }
}

if (!customElements.get('pallet-hero')) customElements.define('pallet-hero', PalletHero);
