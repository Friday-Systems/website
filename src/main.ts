/* Friday Systems — experience page. Port of the design prototypes' page class
   ("Friday Systems - Full Site (Main).dc.html" + "Friday Systems - Mobile.dc.html",
   merged). The two prototypes share one class shape; every fork is a branch on
   `this._touch` (input capability: coarse pointer), exactly mirroring the two
   files. All timings, easings, thresholds and constants are verbatim. */
import './styles/base.css';
import './styles/experience.css';
import './heroes/pallet-hero';
import './heroes/spray-current';
import { getTicker, IS_TOUCH } from './ticker';
import { initCookieBanner, bindCookieSettings } from './cookie';

type SprayEl = HTMLElement & {
  press?: (x: number, y: number) => void;
  release?: () => void;
  nudge?: (x: number, y: number, fx: number, fy: number, r?: number) => void;
  emit?: (x: number, y: number, fraction: number, spread?: number, x2?: number, y2?: number) => void;
  setObstacles?: (rects: unknown[]) => void;
  reset?: () => void;
  paused: boolean;
};
type PalletEl = HTMLElement & { paused: boolean };

const SCRUB_BASE = 'assets/scrubs/';
const SCRUB_BASE_TOUCH = 'assets/scrubs/mobile/'; // shorter mobile encodes (seek granularity)

// Touch grammar tuning knobs (exposed as props on the mobile DC; final values)
const HOLD_DELAY = 280; // ms — stationary hold starts the pour
const STIR_STRENGTH = 10; // scroll-drag stir gain into the spray field

class FSPage {
  _touch = IS_TOUCH;
  _rm = false;
  _dead = false;

  _c01 = (v: number) => Math.min(Math.max(v, 0), 1);
  _easeIO = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  stylesDef = [
    { acc: '#35D0DB', acc2: '#4D5FE0', scrub: 'explosion-scrub-cyan.mp4' },
    { acc: 'oklch(71% 0.19 25)', acc2: 'oklch(60% 0.22 350)', scrub: 'explosion-scrub-coral.mp4' },
    { acc: 'oklch(80% 0.15 135)', acc2: 'oklch(70% 0.14 180)', scrub: 'explosion-scrub-lime.mp4' },
    { acc: 'oklch(69% 0.24 330)', acc2: 'oklch(55% 0.22 290)', scrub: 'explosion-scrub-fuchsia.mp4' },
  ];

  // DOM roots (the DC refs)
  _tunnel: HTMLElement;
  _beltEl: HTMLElement;
  _techEl: HTMLElement | null;

  _el: any;
  _styleI = 0;
  _curStyle: any;
  _pallet: PalletEl | null = null;
  _spray: SprayEl | null = null;
  _phSynced = false;
  _spSynced = false;
  _scrubSynced = false;
  _scrubBlobs: Record<string, Promise<string | null>> | null = null;
  _scrubReq = -1;
  _qNow: number | undefined = undefined;
  _qRest = false;
  _qSm: number | undefined = undefined;
  _qAnim = false;
  _feat = 0;
  _obsAnimUntil = 0;
  _obsOn = false;
  _obsPrev: any = null;
  _obsT = 0;
  _wipeT: any;
  _scrI: any;
  _idxBase: string[] | null = null;
  _idxA = -1;
  _idxX = 0;
  _idxR = 0;
  _idxDrawn: number | undefined = undefined;
  _idxGeo: any = null;
  _hlGeo: any = null;
  _beltGeo: any = null;
  _forceScene = false;
  _vs = 0;
  _vsPrev = 0;
  _vsPainted: number | undefined = undefined;
  _scenePainted: number | undefined = undefined;
  _svPrev = 0;
  _f1Prev = 0;
  _f2Prev = 0;
  _f2Re: number | undefined = undefined;
  _abTop: number | undefined = undefined;
  _abW = -1;
  _abH = -1;
  _abRefit = false;
  _abFontsWait = false;

  // scroll engine state
  _B: number[] | null = null;
  _sy = 0;
  _st = 0;
  _applied = 0;
  _inV = 0;
  _inPeak = 0;
  _inDir = 0;
  _dyEnv = 0;
  _lastInT = 0;
  _committed = true;
  _touchDown = false;
  _tY: number | undefined = undefined;
  _tX: number | undefined = undefined;
  _tNew = false;
  _gRange: [number, number] | undefined = undefined;
  _gY0: number | undefined = undefined;
  _gClampOn = false;
  _fly: { from: number; to: number; t0: number; ms: number } | undefined = undefined;
  _sT: number | undefined = undefined;
  _lastRealY: number | undefined = undefined;
  _lastMoveT = 0;
  _assisted = false;
  _vhC: number | null = null;
  _vhW = 0;

  // touch input grammar
  _tap: { x: number; y: number; t: number; moved: boolean; pour: boolean } | null = null;
  _holdT: any;
  _rotLock = false;
  _rotEl: HTMLElement | null = null;
  _rotMQ: MediaQueryList | null = null;
  _onRotMQ: (() => void) | null = null;

  _io: IntersectionObserver | null = null;
  _tick: (() => void) | null = null;
  _onResolve: any;
  _onResolveMove: any;
  _onRelease: any;
  _onWheel: any;
  _onTouchStart: any;
  _onTouchMove: any;
  _onTouchEnd: any;
  _onAnchorNav: any;
  _entryDone = false;

  constructor() {
    this._tunnel = document.getElementById('top')!;
    this._beltEl = document.querySelector('[data-belt]') as HTMLElement;
    this._techEl = document.getElementById('technology');
    this._rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // device-tier media: touch gets the ~720p encodes
    document.querySelectorAll<HTMLVideoElement>('video[data-src]').forEach((v) => {
      v.src = (this._touch && v.dataset.srcTouch) || v.dataset.src!;
    });
    if (this._touch) {
      const pw = document.querySelector('.pallet-mount');
      if (pw)
        pw.setAttribute(
          'aria-label',
          'Interactive pallet of mixed boxes. Tap to scatter them, press and hold to gather them; the stack always rebuilds itself, box by box. Each tap shifts the accent colors.'
        );
    }

    this._vs = 0;
    this._idxA = -1;
    if (this._touch) {
      // compressed tunnel: one comfortable flick + native inertia ≈ one transition
      const B = this._bounds(),
        TOTAL = B[B.length - 1],
        span = TOTAL + 1;
      const root = this._tunnel;
      if (root) {
        root.style.height = span * 100 + 'svh';
        const pct = (u: number) => ((u / span) * 100).toFixed(3) + '%';
        const so = document.getElementById('solution'),
          te = document.getElementById('technology'),
          ab = document.getElementById('about');
        if (so) so.style.top = pct(B[1]);
        if (te) te.style.top = pct(B[7]); // same boundary index as desktop's 8/11
        if (ab) ab.style.top = pct(B[8]); // desktop's 9/11
      }
    }
    this._playEntry();
    this._initScroll();
    // rotate lock: only landscape PHONES (height < 500px) — landscape tablets pass through
    this._rotEl = this._tunnel ? (document.querySelector('[data-rotate]') as HTMLElement) : null;
    if (this._touch && this._rotEl) {
      this._rotMQ = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
      this._onRotMQ = () => this._setRotLock(this._rotMQ!.matches);
      if (this._rotMQ.addEventListener) this._rotMQ.addEventListener('change', this._onRotMQ);
      else (this._rotMQ as any).addListener(this._onRotMQ);
      if (this._rotMQ.matches) this._setRotLock(true);
    }

    // static template nodes cached once — no per-frame querySelector work
    const root0 = this._tunnel,
      belt0 = this._beltEl;
    const scenes0 = [0, 1, 2, 3].map((i) => root0.querySelector('[data-scene="' + i + '"]') as HTMLElement);
    this._el = {
      scenes: scenes0,
      frames: scenes0.map((s) => s.querySelector('[data-frame]') as HTMLElement),
      idx: document.querySelector('[data-idx]'),
      idxItems: [...document.querySelectorAll('[data-idx-it]')] as HTMLElement[],
      idxFl: document.querySelector('[data-idx-fl]') as HTMLElement,
      idxBx: document.querySelector('[data-idx-bx]') as HTMLElement,
      sprayWrap: document.querySelector('[data-spray-wrap]') as HTMLElement,
      heroHint: document.querySelector('[data-hero-hint]') as HTMLElement,
      exp: root0.querySelector('[data-exp]') as HTMLVideoElement,
      l0: root0.querySelector('[data-hl="0"]') as HTMLElement,
      l1: root0.querySelector('[data-hl="1"]') as HTMLElement,
      cms: [0, 1, 2].map((i) => belt0.querySelector('[data-cm="' + i + '"]') as HTMLElement),
      film: scenes0[1].querySelector('[data-film]') as HTMLVideoElement,
      ko: scenes0[1].querySelector('[data-ko]') as HTMLElement,
      kt: scenes0[1].querySelector('[data-kt]') as HTMLElement,
      solid: scenes0[1].querySelector('[data-solid]') as HTMLElement,
      navy: scenes0[1].querySelector('[data-navy]') as HTMLElement,
      grade: scenes0[1].querySelector('[data-grade]') as HTMLElement,
      abgiant: scenes0[3].querySelector('[data-abgiant]') as HTMLElement,
      abmsg: scenes0[3].querySelector(this._touch ? '[data-abmsg-touch]' : '[data-abmsg-desktop]') as HTMLElement,
      about: document.getElementById('about'),
    };
    this._el.cmFill = this._el.cms.map((el: HTMLElement) => [...el.querySelectorAll('[data-fill]')]);
    this._el.cmOut = this._el.cms.map((el: HTMLElement) => [...el.querySelectorAll('[data-outline]')]);

    this._initIndexScrub();
    this._prefetchFilms();

    // accent re-solve: random seed per visit, pointer press anywhere cycles
    this._styleI = Math.floor(Math.random() * this.stylesDef.length);
    this._applyAccent(this._styleI, false);
    if (this._touch) {
      // Mobile touch grammar. Desktop fires the re-solve on pointerdown; on touch
      // that would recolor on every scroll grab. Qualified tap (<10px, <300ms) =
      // accent cycle + announce burst; stationary hold >= holdDelay = pour (accent
      // cycles at hold start, mirroring desktop where the press carries the new
      // color); drag = never.
      this._onResolve = (ev: PointerEvent) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        if ((ev.target as Element).closest('a, button, input, textarea, [data-noresolve]')) return;
        this._tap = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false, pour: false };
        clearTimeout(this._holdT);
        this._holdT = setTimeout(() => {
          if (this._tap && !this._tap.moved) {
            this._tap.pour = true;
            this._cycle(this._tap.x, this._tap.y);
          }
        }, HOLD_DELAY);
      };
      this._onResolveMove = (ev: PointerEvent) => {
        const tp = this._tap;
        if (tp && !tp.moved && Math.hypot(ev.clientX - tp.x, ev.clientY - tp.y) > 10) tp.moved = true;
      };
      document.addEventListener('pointerdown', this._onResolve);
      document.addEventListener('pointermove', this._onResolveMove, { passive: true });
      this._onRelease = () => {
        clearTimeout(this._holdT);
        const tap = this._tap;
        this._tap = null;
        if (tap && !tap.pour && !tap.moved && performance.now() - tap.t < 300) {
          this._cycle(tap.x, tap.y); // burst: press + near-immediate release
          setTimeout(() => {
            if (this._spray && this._spray.release) this._spray.release();
          }, 120);
          return;
        }
        if (this._spray && this._spray.release) this._spray.release();
      };
      window.addEventListener('pointerup', this._onRelease);
      window.addEventListener('pointercancel', this._onRelease);
    } else {
      // pointerdown (not click): the style must snap at press start so the spray's
      // announce burst and a hold-pour carry the NEW color from the first frame
      this._onResolve = (ev: PointerEvent) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        if ((ev.target as Element).closest('a, button, input, textarea, [data-noresolve]')) return;
        this._cycle(ev.clientX, ev.clientY);
      };
      document.addEventListener('pointerdown', this._onResolve);
      this._onRelease = () => {
        if (this._spray && this._spray.release) this._spray.release();
      };
      window.addEventListener('pointerup', this._onRelease);
      window.addEventListener('pointercancel', this._onRelease);
    }
    this._initCards();

    // reduced motion: hold a static first frame instead of looping video
    const initVideo = (v: HTMLVideoElement) => {
      v.muted = true;
      if (this._rm) {
        v.autoplay = false;
        v.preload = 'auto';
        v.pause();
      }
    };
    this._io = new IntersectionObserver(
      (ents) => {
        ents.forEach((en) => {
          (en.target as HTMLElement).querySelectorAll('video').forEach((v) => {
            if (v.hasAttribute('data-exp')) {
              v.pause();
              return;
            } // scrub-only, never plays
            if (v.hasAttribute('data-cfilm')) {
              if (!en.isIntersecting) {
                v.pause();
              } else {
                const c = v.closest('[data-card]');
                if (c && !this._rm && +c.getAttribute('data-card')! === (this._feat || 0)) {
                  const p = v.play();
                  if (p && p.catch) p.catch(() => {});
                }
              }
              return;
            }
            if (en.isIntersecting && !this._rm) {
              const p = v.play();
              if (p && p.catch) p.catch(() => {});
            } else v.pause();
          });
        });
      },
      { rootMargin: '30% 0px' }
    );
    const root = this._tunnel;
    if (root) {
      root.querySelectorAll('video').forEach(initVideo);
      this._io.observe(root);
    }
    const troot = this._techEl;
    if (troot) {
      troot.querySelectorAll('video').forEach(initVideo);
      this._io.observe(troot);
    }

    // single page-wide rAF ticker: page scroll/scenes + both heroes subscribe
    this._tick = () => {
      if (!this._dead) this._update();
    };
    getTicker().add(this._tick);

    bindCookieSettings();
  }

  // mobile tier (site feedback): the entrance loader is prefetch head-start —
  // pull the films into blob URLs in scroll order (Proof first, then the tech
  // cards) so every scene starts instantly, the way the scrubs already do.
  // Sequential so the first-needed file gets the whole pipe; skipped for
  // data-saver users. Desktop streams (faststart moov + preload=auto).
  _prefetchFilms() {
    if (!this._touch) return;
    const conn = (navigator as any).connection;
    if (conn && conn.saveData) return;
    const vids = [...document.querySelectorAll<HTMLVideoElement>('video[data-src]')];
    vids.sort((a, b) => (b.hasAttribute('data-film') ? 1 : 0) - (a.hasAttribute('data-film') ? 1 : 0));
    const adopt = (v: HTMLVideoElement, url: string) => {
      const t = v.currentTime,
        playing = !v.paused && !v.ended;
      v.src = url;
      if (t > 0.05 || playing) {
        v.addEventListener(
          'loadedmetadata',
          () => {
            if (t > 0.05) {
              try {
                v.currentTime = t;
              } catch (err) {}
            }
            if (playing) {
              const p = v.play();
              if (p && p.catch) p.catch(() => {});
            }
          },
          { once: true }
        );
      }
    };
    let chain: Promise<void> = Promise.resolve();
    vids.forEach((v) => {
      const src = v.src;
      chain = chain
        .then(() =>
          fetch(src).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r.blob();
          })
        )
        .then((b) => adopt(v, URL.createObjectURL(b)))
        .catch(() => {}); // keep streaming from the network src
    });
  }

  _cycle(x: number, y: number) {
    this._styleI = (this._styleI + 1) % this.stylesDef.length;
    this._applyAccent(this._styleI, !this._rm);
    // eager-swap the scrub only while the transition is parked at either end
    if (this._qNow === undefined || this._qNow <= 0.001 || this._qNow >= 0.999) this._syncScrub();
    if (this._spray && this._spray.press) this._spray.press(x, y);
  }

  // scrub video tracks the active accent while the transition is at rest;
  // once in motion the src is frozen — you exit with the color you entered with.
  // Files are fetched into blob URLs (making later swaps instant). Current
  // accent fetched first, the rest prefetched in the background.
  _scrubUrl(i: number) {
    const file = this.stylesDef[i].scrub;
    if (!this._scrubBlobs) this._scrubBlobs = {};
    if (!this._scrubBlobs[file]) {
      const get = (base: string) =>
        fetch(base + file).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        });
      this._scrubBlobs[file] = (this._touch ? get(SCRUB_BASE_TOUCH).catch(() => get(SCRUB_BASE)) : get(SCRUB_BASE))
        .then((b) => URL.createObjectURL(b))
        .catch(() => {
          delete this._scrubBlobs![file];
          return null;
        });
    }
    return this._scrubBlobs[file];
  }
  _syncScrub() {
    const exp = this._el && this._el.exp;
    if (!exp) return;
    const styleAtRequest = this._styleI;
    this._scrubReq = styleAtRequest;
    this._scrubUrl(styleAtRequest).then((url) => {
      // stale-guard: only the latest request wins, and never swap mid-scrub
      if (!url || this._scrubReq !== styleAtRequest) return;
      if (this._qNow !== undefined && this._qNow > 0.001 && this._qNow < 0.999) return;
      if (exp.getAttribute('src') !== url) {
        exp.setAttribute('src', url);
        exp.load();
      }
    });
  }
  _prefetchScrubs() {
    this.stylesDef.forEach((_, i) => {
      if (i !== this._styleI) this._scrubUrl(i);
    });
  }

  _syncPallet(i: number) {
    // page _styleI is the single source of truth; the hero adopts it via attribute
    const ph = document.querySelector('pallet-hero') as PalletEl | null;
    if (ph) {
      ph.setAttribute('style-index', String(i));
      this._pallet = ph;
      this._phSynced = true;
      this._forceScene = true;
    }
  }

  _syncSpray(i: number) {
    const sp = document.querySelector('spray-current') as SprayEl | null;
    if (sp) {
      sp.setAttribute('style-index', String(i));
      this._spray = sp;
      this._spSynced = true;
      this._forceScene = true;
    }
  }

  _applyAccent(i: number, animate: boolean) {
    this._syncPallet(i);
    this._syncSpray(i);
    const prev = this._curStyle || this.stylesDef[0];
    const st = this.stylesDef[i];
    this._curStyle = st;
    const b = document.body.style;
    if (!animate) {
      b.setProperty('transition', 'none');
      b.setProperty('--acc', st.acc);
      b.setProperty('--acc2', st.acc2);
      requestAnimationFrame(() => b.removeProperty('transition'));
      return;
    }
    b.setProperty('--acc', st.acc);
    b.setProperty('--acc2', st.acc2);
    clearTimeout(this._wipeT);
    const words = document.querySelectorAll<HTMLElement>('[data-gw]');
    words.forEach((el) => {
      el.style.transition = 'none';
      el.style.backgroundImage =
        'linear-gradient(100deg,' + st.acc2 + ' 0%,' + st.acc + ' 38%,' + prev.acc2 + ' 62%,' + prev.acc + ' 100%)';
      el.style.backgroundSize = '280% 100%';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = '100% 0';
    });
    void document.body.offsetWidth;
    words.forEach((el) => {
      el.style.transition = 'background-position 0.6s ease';
      el.style.backgroundPosition = '0% 0';
    });
    this._wipeT = setTimeout(() => {
      words.forEach((el) => {
        el.style.transition = '';
        el.style.backgroundImage = 'var(--grad)';
        el.style.backgroundSize = '';
        el.style.backgroundRepeat = '';
        el.style.backgroundPosition = '';
      });
    }, 700);
    this._scrambleIndex();
  }

  _scrambleIndex() {
    if (this._rm) return;
    const items = document.querySelectorAll<HTMLElement>('[data-idx-it]');
    if (!items.length) return;
    if (!this._idxBase) this._idxBase = [...items].map((el) => el.textContent || '');
    clearInterval(this._scrI);
    const glyphs = '#/\\<>01XZK';
    let t = 0;
    this._scrI = setInterval(() => {
      t++;
      if (t >= 7) {
        clearInterval(this._scrI);
        items.forEach((el, k) => {
          el.textContent = this._idxBase![k];
        });
        return;
      }
      const p = 1 - t / 7;
      items.forEach((el, k) => {
        el.textContent = this._idxBase![k]
          .split('')
          .map((c) => (c !== ' ' && Math.random() < p * 0.5 ? glyphs[Math.floor(Math.random() * glyphs.length)] : c))
          .join('');
      });
    }, 50);
  }

  _setFeatured(i: number) {
    this._feat = i;
    this._obsAnimUntil = performance.now() + 1100; // width/height transition is 0.9s
    document.querySelectorAll<HTMLElement>('[data-card]').forEach((c) => {
      const on = +c.getAttribute('data-card')! === i;
      if (this._touch) c.style.height = on ? 'var(--card-wide)' : 'var(--card-narrow)'; // mobile accordion: featured = tall
      else c.style.width = on ? 'var(--card-wide)' : 'var(--card-narrow)';
      const v = c.querySelector('[data-cfilm]') as HTMLVideoElement | null;
      if (v) {
        v.style.filter = 'var(--film-base) brightness(' + (on ? 0.92 : 0.5) + ')';
        if (on && !this._rm) {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } else v.pause();
      }
      // single title stays visible and re-wraps with the card width; only the body copy collapses.
      const para = c.querySelector('[data-cfull] p') as HTMLElement | null;
      if (para) {
        para.style.opacity = on ? '1' : '0';
        para.style.maxHeight = on ? '200px' : '0';
        para.style.margin = on ? '12px 0 0' : '0';
      }
      const hint = c.querySelector('[data-chint]') as HTMLElement | null;
      if (hint) hint.style.opacity = on ? '0' : '1';
    });
  }

  // tech cards are solid obstacles in the spray field: rects measured every
  // frame while scene 2 is on screen, so the fly-in and expand/collapse read
  // as physical events (translation + growth velocity injected into the field)
  _syncCardObstacles(stTech: any) {
    const spray = this._spray;
    if (!spray || !spray.setObstacles) return;
    // past > 0 as soon as the About dolly-in starts scaling the scene forward:
    // drop the obstacles immediately so the exit flight doesn't stir the field
    const on = stTech && stTech.inFly > 0.12 && stTech.past < 0.01;
    if (!on) {
      if (this._obsOn) {
        spray.setObstacles([]);
        this._obsOn = false;
        this._obsPrev = null;
        // exit refill: jets stir the grains back across the space the cards held
        if (stTech && stTech.past >= 0.01 && spray.nudge) {
          const W = window.innerWidth,
            vh = window.innerHeight;
          // pinwheel: 4 corner jets, each aimed just off-center so they shear past
          // one another and spin up a central vortex (head-on jets cancel, no mixing)
          spray.nudge(W * 0.2, vh * 0.22, 850, -220, 6);
          spray.nudge(W * 0.8, vh * 0.78, -850, 220, 6);
          spray.nudge(W * 0.78, vh * 0.24, -220, ((-850 * vh) / W) * 1.6, 6);
          spray.nudge(W * 0.22, vh * 0.76, 220, ((850 * vh) / W) * 1.6, 6);
          // (fresh grains now come from the full-pool curtain re-seed that the
          // Tech->About dolly drives in _update — site feedback)
        }
      }
      return;
    }
    const now = performance.now();
    const dts = this._obsPrev ? Math.min(Math.max((now - this._obsT) / 1000, 0.008), 0.05) : 0.016;
    this._obsT = now;
    const prev = this._obsPrev || (this._obsPrev = []);
    const list: any[] = [];
    document.querySelectorAll('[data-scene="2"] [data-card]').forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const p = prev[i];
      list.push({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        radius: 20 * (stTech.s || 1),
        vx: p ? (cx - p.cx) / dts : 0,
        vy: p ? (cy - p.cy) / dts : 0,
        gx: p ? (r.width - p.w) / 2 / dts : 0,
        gy: p ? (r.height - p.h) / 2 / dts : 0,
      });
      prev[i] = { cx, cy, w: r.width, h: r.height };
    });
    spray.setObstacles(list);
    this._obsOn = true;
  }

  _initCards() {
    const wrap = document.querySelector('[data-cards]');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const c = (e.target as Element).closest('[data-card]');
      if (c) this._setFeatured(+c.getAttribute('data-card')!);
    });
    this._setFeatured(0);
  }

  // rotate lock: landscape phones (coarse pointer, height < 500px) pause the
  // experience behind a branded prompt; portrait return re-derives geometry
  // and snaps to the nearest scene boundary (raw px offset would land
  // mid-transition in the new viewport math).
  _setRotLock(on: boolean) {
    if (!!this._rotLock === !!on) return;
    this._rotLock = on;
    const el = this._rotEl;
    if (el) {
      el.style.visibility = 'visible';
      el.style.opacity = on ? '1' : '0';
      el.style.pointerEvents = on ? 'auto' : 'none';
    }
    if (on) {
      clearTimeout(this._holdT);
      this._tap = null; // no accidental pour/cycle mid-rotation
      if (this._spray) this._spray.paused = true;
      if (this._pallet) this._pallet.paused = true;
      document.querySelectorAll('video').forEach((v) => v.pause());
      document.documentElement.style.overflow = 'hidden'; // no scrubbing while layout math is invalid
      return;
    }
    document.documentElement.style.overflow = '';
    this._vhC = null;
    this._abW = -1;
    this._forceScene = true; // re-derive svh geometry
    const vh = this._vhStable();
    const root = this._tunnel;
    if (root) {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const B = this._bounds(),
        TOTAL = B[B.length - 1];
      const yu = Math.max(0, Math.min(TOTAL, (window.scrollY - top) / vh));
      let best = B[0],
        bd = Infinity;
      B.forEach((b) => {
        const d = Math.abs(yu - b);
        if (d < bd) {
          bd = d;
          best = b;
        }
      });
      const y = Math.round(top + best * vh);
      window.scrollTo(0, y);
      this._sy = this._st = this._applied = y;
      this._fly = undefined;
      this._gRange = undefined;
      this._committed = true;
      this._inV = 0;
      this._inPeak = 0;
    }
    // re-fire the intersection logic so in-view films resume (heroes un-pause
    // via _update, which owns their .paused per scene)
    if (this._io) {
      if (root) {
        this._io.unobserve(root);
        this._io.observe(root);
      }
      const tr = this._techEl;
      if (tr) {
        this._io.unobserve(tr);
        this._io.observe(tr);
      }
    }
  }

  // entrance: tetris pieces lock into a square, square expands, fades to site
  _playEntry() {
    const ov = document.querySelector('[data-entry]') as HTMLElement | null;
    if (!ov) return;
    const grid = ov.querySelector('[data-entry-grid]') as HTMLElement;
    const fill = ov.querySelector('[data-entry-fill]') as HTMLElement;
    const pieces = [...ov.querySelectorAll('[data-entry-piece]')] as HTMLElement[];
    const done = () => {
      ov.style.display = 'none';
      if (!this._entryDone) {
        this._entryDone = true;
        initCookieBanner();
      }
    };
    if (this._rm) {
      ov.style.transition = 'opacity 0.5s ease';
      ov.style.opacity = '0';
      setTimeout(done, 550);
      return;
    }
    const total = 1500,
      interval = total / 4,
      dropMs = interval * 0.72;
    const hold = 240,
      dollyDur = 850,
      fadeDur = 800;
    const cover = (Math.hypot(window.innerWidth, window.innerHeight) / 112) * 1.15;
    const S = this._touch ? 0.72 : 1; // touch loader rests smaller; the dolly expands from S up to cover
    const y0 = -(window.innerHeight / 2 + 160);
    pieces.forEach((p) => {
      p.style.transform = 'translateY(' + y0 + 'px)';
    });
    const easeIn = (t: number) => t * t * t;
    const easeIO = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const lockAll = () =>
      pieces.forEach((p) => {
        p.style.opacity = '1';
        p.style.transform = 'translateY(0px) rotate(0deg)';
      });
    const t0 = performance.now();
    const tick = (now: number) => {
      if (this._dead) return done();
      const t = now - t0;
      if (t < total) {
        pieces.forEach((p, i) => {
          const lt = t - i * interval;
          if (lt < 0) return;
          p.style.opacity = '1';
          const q = Math.min(1, lt / dropMs);
          const y = y0 * (1 - q * q);
          const rot = p.dataset.spin === '1' ? (1 - q) * 90 : 0;
          const squash = q >= 1 && lt < dropMs + 90 ? 1 - 0.07 * Math.sin((Math.PI * (lt - dropMs)) / 90) : 1;
          p.style.transform =
            'translateY(' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg) scaleY(' + squash.toFixed(3) + ')';
        });
      } else if (t < total + hold) {
        lockAll();
      } else if (t < total + hold + dollyDur) {
        lockAll();
        const e = easeIn(Math.min(1, (t - total - hold) / dollyDur));
        fill.style.opacity = Math.min(1, e * 8).toFixed(2);
        grid.style.transform = 'scale(' + (S + e * (cover - S)).toFixed(3) + ')';
      } else {
        lockAll();
        fill.style.opacity = '1';
        grid.style.transform = 'scale(' + cover.toFixed(3) + ')';
        const f = easeIO(Math.min(1, (t - total - hold - dollyDur) / fadeDur));
        ov.style.opacity = (1 - f).toFixed(3);
        if (f >= 1) return done();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ============ Global scroll layer: one config for the whole page ============
  // lerp 0.09/frame, wheel deltas normalized + clamped to ±220px/event,
  // velocity cap 2.4vh/frame, identical in both directions. Wheel AND touch are
  // hijacked on the desktop tier; the touch tier runs native scroll with a
  // per-gesture clamp + snap assist. One gesture engages exactly one transition
  // (clamped at its far boundary — a new gesture is required to enter the next
  // one). Keyboard and scrollbar stay native as an escape hatch.
  _bounds() {
    // uniform distance 1 unit (100vh); the unified converge+explosion gets 2
    // (two chained events — keeps the explosion's full scrub length).
    // [converge+explosion, wheel×3, beltExit, deployments, techFly, aboutFly, riser]
    if (!this._B) {
      const a = [0];
      // touch: shorter units — one native flick's travel + inertia covers a transition
      (this._touch ? [1.2, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7] : [2, 1, 1, 1, 1, 1, 1, 1, 1]).forEach((u) =>
        a.push(a[a.length - 1] + u)
      );
      this._B = a;
    }
    return this._B;
  }
  // nearest transition boundary within `frac` units of y, or undefined (touch snap-assist)
  _nearBoundary(vh: number, y: number, frac: number) {
    const root = this._tunnel;
    if (!root) return undefined;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const B = this._bounds(),
      TOTAL = B[B.length - 1];
    const yu = (y - top) / vh;
    if (yu <= 0.01 || yu >= TOTAL - 0.01) return undefined;
    let best = B[0],
      bd = Infinity;
    for (let i = 0; i < B.length; i++) {
      const d = Math.abs(yu - B[i]);
      if (d < bd) {
        bd = d;
        best = B[i];
      }
    }
    if (bd > frac || bd < 0.002) return undefined;
    return top + best * vh;
  }
  // stable viewport height (100svh via the stage) — window.innerHeight shifts as
  // the iOS toolbar collapses, which would move transition boundaries mid-scroll
  _vhStable() {
    const w = window.innerWidth;
    if (!this._vhC || this._vhW !== w) {
      const st = document.querySelector('[data-stage]') as HTMLElement | null;
      this._vhC = (st && st.offsetHeight) || window.innerHeight;
      this._vhW = w;
    }
    return this._vhC;
  }
  _vh() {
    return this._touch ? this._vhStable() : window.innerHeight;
  }
  // the one transition a gesture may engage, as a [loPx, hiPx] clamp range:
  // starting at a boundary → the next transition in the travel direction;
  // starting mid-transition → that transition only. Past the tunnel, the
  // footer region is its own step.
  _gestureRange(dir: number): [number, number] | undefined {
    const root = this._tunnel;
    if (!root) return undefined;
    const vh = this._vh();
    const top = root.getBoundingClientRect().top + window.scrollY;
    const max = Math.max(0, document.documentElement.scrollHeight - vh);
    const B = this._bounds(),
      n = B.length,
      TOTAL = B[n - 1];
    const yu = (this._st - top) / vh,
      eps = 0.02;
    if (yu >= TOTAL - eps) {
      if (dir > 0 || yu > TOTAL + eps) return [Math.min(max, top + TOTAL * vh), max];
      return [top + B[n - 2] * vh, top + TOTAL * vh];
    }
    let i = 0;
    while (i < n - 2 && yu >= B[i + 1]) i++;
    let lo, hi;
    if (yu <= B[i] + eps && dir < 0) {
      lo = B[Math.max(0, i - 1)];
      hi = B[i];
    } else if (yu >= B[i + 1] - eps && dir > 0) {
      if (i + 1 === n - 1) return [Math.min(max, top + TOTAL * vh), max];
      lo = B[i + 1];
      hi = B[i + 2];
    } else {
      lo = B[i];
      hi = B[i + 1];
    }
    return [Math.max(0, top + lo * vh), Math.min(max, top + hi * vh)];
  }
  _initScroll() {
    this._sy = this._st = this._applied = window.scrollY;
    this._inV = 0;
    this._inPeak = 0;
    this._lastInT = 0;
    this._committed = true;
    if (!this._rm && this._touch) {
      // NATIVE-SCROLL MODE (touch): the browser owns all scroll physics — no
      // preventDefault, no synthetic scrollTo. Listeners only stir the spray
      // along the finger track and cancel a snap-assist in progress.
      // ONE GESTURE = ONE TRANSITION: each touchstart opens a fresh clamp range;
      // the frame mirror in _scrollStep pins the native scroll (drag + its
      // inertia) at that range's far boundary until the next touch.
      this._onTouchStart = (e: TouchEvent) => {
        const t = e.touches[0];
        this._tY = t.clientY;
        this._tX = t.clientX;
        this._touchDown = true;
        this._fly = undefined;
        this._gY0 = window.scrollY;
        this._gRange = undefined;
        this._gClampOn = true;
      };
      this._onTouchMove = (e: TouchEvent) => {
        if (this._rotLock || e.touches.length !== 1) return;
        const t = e.touches[0],
          y = t.clientY,
          x = t.clientX;
        const dy = (this._tY === undefined ? y : this._tY) - y;
        this._tY = y;
        const dx = x - (this._tX === undefined ? x : this._tX);
        this._tX = x;
        if (this._spray && this._spray.nudge && (dx || dy)) {
          const k = STIR_STRENGTH;
          this._spray.nudge(x, y, Math.max(-900, Math.min(900, dx * k)), Math.max(-900, Math.min(900, dy * k)), 2.5);
        }
      };
      this._onTouchEnd = () => {
        this._touchDown = false;
        this._lastMoveT = performance.now();
      };
      window.addEventListener('touchstart', this._onTouchStart, { passive: true });
      window.addEventListener('touchmove', this._onTouchMove, { passive: true });
      window.addEventListener('touchend', this._onTouchEnd);
      window.addEventListener('touchcancel', this._onTouchEnd);
    } else if (!this._rm) {
      this._onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch zoom stays native
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 40;
        else if (e.deltaMode === 2) dy *= window.innerHeight;
        dy = Math.max(-220, Math.min(220, dy)); // input normalization
        this._input(dy);
      };
      window.addEventListener('wheel', this._onWheel, { passive: false });
      // touch hijack (desktop tier — hybrid/touchscreen laptops): finger scrubs
      // 1:1 through our pipeline; release commits
      this._onTouchStart = (e: TouchEvent) => {
        this._tY = e.touches[0].clientY;
        this._touchDown = true;
        this._tNew = true;
      };
      this._onTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        const y = e.touches[0].clientY;
        const dy = (this._tY === undefined ? y : this._tY) - y;
        this._tY = y;
        if (dy) {
          this._input(dy, this._tNew);
          this._tNew = false;
        }
      };
      this._onTouchEnd = () => {
        this._touchDown = false;
        this._lastInT = performance.now();
      };
      window.addEventListener('touchstart', this._onTouchStart, { passive: true });
      window.addEventListener('touchmove', this._onTouchMove, { passive: false });
      window.addEventListener('touchend', this._onTouchEnd);
      window.addEventListener('touchcancel', this._onTouchEnd);
    }
    this._onAnchorNav = (e: MouseEvent) => {
      const a = (e.target as Element).closest('a[href^="#"]');
      if (!a) return;
      const el = document.getElementById(a.getAttribute('href')!.slice(1));
      if (!el) return;
      if (this._touch) {
        e.preventDefault();
        const y = el.getBoundingClientRect().top + window.scrollY;
        // touch + reduced motion: let the browser drive (native scroll owns physics
        // in touch mode; the custom fly can be canceled by toolbar-resize jumps)
        this._fly = undefined;
        this._assisted = true;
        this._gClampOn = false;
        this._gRange = undefined; // nav is not a gesture — never clamp it
        try {
          window.scrollTo({ top: y, behavior: this._rm ? 'auto' : 'smooth' });
        } catch {
          window.scrollTo(0, y);
        }
      } else {
        if (this._rm) return;
        e.preventDefault();
        this._flyTo(el.getBoundingClientRect().top + window.scrollY);
      }
    };
    document.addEventListener('click', this._onAnchorNav);
  }
  _input(dy: number, forceNew?: boolean) {
    const now = performance.now();
    // new-gesture detection (quiet-gate): explicit start (touch), a real pause,
    // a direction flip, or a delta rising well above the decaying inertia tail
    const gap = now - (this._lastInT || 0);
    const flip = this._inDir && dy && dy > 0 !== this._inDir > 0;
    const rising = Math.abs(dy) > (this._dyEnv || 0) * 2 + 12;
    // gesture spent (site feedback): its transition has fully arrived and rests
    // at the gesture range's far boundary — the next meaningful event starts a
    // new gesture immediately, so rhythmic scrolls aren't swallowed by the
    // 300ms quiet-gap. Trackpad inertia stays contained: while the scrub is
    // still travelling (|st−sy| ≥ 1) nothing re-arms, and by the time it
    // arrives (~0.7s under the velocity cap) a momentum tail has decayed
    // below the 20px floor.
    const spent =
      !!this._gRange &&
      Math.abs(dy) > 20 &&
      Math.abs(this._st - this._sy) < 1 &&
      (this._st === this._gRange[0] || this._st === this._gRange[1]);
    if (forceNew || gap > 300 || flip || rising || spent) {
      this._inV = 0;
      this._inPeak = 0;
      this._dyEnv = 0;
      this._gRange = undefined;
    }
    const dt = Math.min(Math.max(now - (this._lastInT || now - 16), 1), 200);
    if (this._fly) {
      this._st = this._sy;
      this._fly = undefined;
    } // cancel settle: rebase to where we are
    this._lastInT = now;
    this._committed = false;
    if (dy) this._inDir = dy > 0 ? 1 : -1;
    if (!this._gRange && dy) this._gRange = this._gestureRange(this._inDir);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const lo = this._gRange ? this._gRange[0] : 0,
      hi = this._gRange ? this._gRange[1] : max;
    this._st = Math.max(lo, Math.min(hi, this._st + dy)); // one gesture = one transition
    const v = (dy / dt) * 1000; // px/s
    this._inV = this._inV * 0.7 + v * 0.3;
    this._inPeak = Math.max(this._inPeak * Math.pow(0.9994, dt), Math.abs(this._inV));
    this._dyEnv = Math.max((this._dyEnv || 0) * 0.95, Math.abs(dy));
  }
  _flyTo(y: number) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    y = Math.max(0, Math.min(max, y));
    this._fly = {
      from: this._sy,
      to: y,
      t0: performance.now(),
      ms: Math.max(500, Math.min(1500, 400 + Math.abs(y - this._sy) * 0.1)),
    };
    this._st = y;
    this._committed = true;
    this._inPeak = 0;
    this._inV = 0;
    this._gRange = undefined;
  }
  // commit rule: input ended inside a transition → always complete forward in the
  // direction of travel; never revert against it. Exception: a gesture whose peak
  // velocity stayed low is a deliberate slow scrub and rests where it is.
  _boundaryTarget(vh: number) {
    const root = this._tunnel;
    if (!root) return undefined;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const B = this._bounds(),
      TOTAL = B[B.length - 1];
    const yu = (this._st - top) / vh;
    if (yu <= 0.01 || yu >= TOTAL - 0.01) return undefined; // outside the mapped tunnel
    let i = 0;
    while (i < B.length - 2 && yu >= B[i + 1]) i++;
    const p = (yu - B[i]) / (B[i + 1] - B[i]);
    if (p < 0.02 || p > 0.98) return top + B[p < 0.02 ? i : i + 1] * vh; // hair off: snap in place
    if (this._inPeak < 700) return undefined; // gentle gesture: rest where it is (never revert)
    const dir = this._inDir || 1;
    return top + B[dir > 0 ? i + 1 : i] * vh;
  }
  _scrollStep(vh: number) {
    if (this._rm) return;
    const now = performance.now();
    if (this._touch) {
      // native scroll owns physics; mirror it, plus snap-ASSIST (not law): once
      // scrolling goes idle within a fraction of a boundary, ease the last bit closed
      let realY = window.scrollY;
      // one gesture = one transition: hard-clamp the native scroll (finger drag
      // and the inertia that follows it) inside the range opened at touchstart
      if (this._gClampOn && !this._fly) {
        if (!this._gRange && this._gY0 !== undefined && Math.abs(realY - this._gY0) > 2) {
          this._st = this._gY0; // range is anchored at the gesture's start position
          this._gRange = this._gestureRange(realY > this._gY0 ? 1 : -1);
        }
        if (this._gRange) {
          const cl = Math.max(this._gRange[0], Math.min(this._gRange[1], realY));
          if (Math.abs(cl - realY) > 0.5) {
            window.scrollTo(0, cl);
            realY = cl;
          }
        }
      }
      if (this._fly) {
        if (Math.abs(realY - this._applied) > 1.5) {
          this._fly = undefined;
          this._sy = this._st = this._applied = realY;
          return;
        } // user scrolled: yield instantly
        const f = this._fly,
          p = Math.min(1, (now - f.t0) / f.ms);
        this._sy = this._st = f.from + (f.to - f.from) * this._easeIO(p);
        if (p >= 1) this._fly = undefined;
        const y = Math.round(this._sy);
        if (y !== this._applied) {
          this._applied = y;
          window.scrollTo(0, y);
        }
        return;
      }
      if (this._lastRealY === undefined || Math.abs(realY - this._lastRealY) > 0.5) {
        this._lastMoveT = now;
        this._assisted = false;
      }
      this._lastRealY = realY;
      this._sy = this._st = this._applied = realY;
      if (!this._touchDown && !this._assisted && now - (this._lastMoveT || 0) > 120) {
        this._assisted = true;
        // 0.61: covers the midpoint of every segment (widest is 1.2u) — boundaries
        // are the only rest states, so a dead fling always eases to the nearest one.
        // Mid-transition rests broke re-arming of the fly-ignition jets (f1/f2 never
        // returned to 0), which is why Tech→About jets wouldn't re-fire on mobile.
        const b = this._nearBoundary(vh, realY, 0.61);
        if (b !== undefined && Math.abs(b - realY) > 1)
          this._fly = { from: realY, to: b, t0: now, ms: Math.min(450, 240 + Math.abs(b - realY) * 0.5) };
      }
      return;
    }
    const dtF = Math.min((now - (this._sT || now)) / 16.7, 4) || 1;
    this._sT = now;
    const max = Math.max(0, document.documentElement.scrollHeight - vh);
    const realY = window.scrollY;
    if (Math.abs(realY - this._applied) > 1.5) {
      // external scroll (keyboard, scrollbar): adopt as-is, ungated
      if (now - (this._lastInT || 0) > 300) {
        this._inV = 0;
        this._inPeak = 0;
      } // new gesture: drop stale velocity
      this._gRange = undefined;
      this._dyEnv = 0;
      const v = ((realY - this._applied) / (dtF * 16.7)) * 1000;
      if (v) this._inDir = v > 0 ? 1 : -1;
      this._inV = this._inV * 0.6 + v * 0.4;
      this._inPeak = Math.max(this._inPeak, Math.abs(this._inV));
      this._sy = this._st = this._applied = realY;
      this._lastInT = now;
      this._committed = false;
      this._fly = undefined;
    }
    if (this._fly) {
      const f = this._fly,
        p = Math.min(1, (now - f.t0) / f.ms);
      const e = this._easeIO(p);
      this._sy = f.from + (f.to - f.from) * e;
      if (p >= 1) this._fly = undefined;
    } else {
      if (!this._committed && !this._touchDown && this._lastInT && now - this._lastInT > 140) {
        // settle = retarget the same lerp that drives scrubbing to the boundary;
        // physically identical to scroll feel, no separate settle animation
        const b = this._boundaryTarget(vh);
        if (b !== undefined) this._st = b;
        this._committed = true;
        this._inPeak = 0;
      }
      let step = (this._st - this._sy) * (1 - Math.pow(1 - 0.09, dtF));
      const cap = vh * 0.024 * dtF; // velocity cap: max px advanced per frame
      if (step > cap) step = cap;
      else if (step < -cap) step = -cap;
      this._sy += step;
      if (Math.abs(this._st - this._sy) < 0.3) this._sy = this._st;
    }
    this._sy = Math.max(0, Math.min(max, this._sy));
    const y = Math.round(this._sy);
    if (y !== this._applied) {
      this._applied = y;
      window.scrollTo(0, y);
    }
  }

  // ---- interactive index slider (site feedback): the progress track is a
  // scrubber. Desktop: click = glide there (same _flyTo as the labels), drag =
  // 1:1 scrub through the native escape-hatch path (external-scroll adoption —
  // the engine treats it like the scrollbar, and the release settle reuses the
  // standard commit rule). Touch: qualified tap = smooth-jump (mirrors anchor
  // nav; no drag — the track is too small to fight the page gesture for).
  _initIndexScrub() {
    const E = this._el;
    const track = E && E.idxFl && (E.idxFl.parentElement as HTMLElement);
    if (!track) return;
    let dragging = false,
      moved = false,
      downX = 0,
      downY = 0,
      downT = 0;
    // invert _updateIndex's piecewise map: track x -> document scroll y
    const yFor = (clientX: number): number | undefined => {
      const G = this._idxGeo;
      if (!G) return undefined;
      const r = track.getBoundingClientRect();
      const scale = r.width / Math.max(1, G.W); // --vp-fix compensation scale
      const x = Math.min(Math.max((clientX - r.left) / scale, 0), G.W);
      const lerp = (x0: number, x1: number, v0: number, v1: number) =>
        v0 + (v1 - v0) * ((x - x0) / Math.max(1, x1 - x0));
      let y;
      if (x < G.xs[0]) y = lerp(0, G.xs[0], 0, G.b1);
      else if (x < G.xs[1]) y = lerp(G.xs[0], G.xs[1], G.b1, G.b2);
      else if (x < G.xs[2]) y = lerp(G.xs[1], G.xs[2], G.b2, G.b3);
      else y = lerp(G.xs[2], G.W, G.b3, G.yEnd);
      y -= this._vh() * 0.5; // the map is anchored at viewport center
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(max, y));
    };
    // click/tap jumps snap to the nearest scene boundary — boundaries are the
    // only rest states. Drags rest wherever the standard settle puts them.
    const snapB = (y: number) => {
      const root = this._tunnel;
      if (!root) return y;
      const vh = this._vh();
      const top = root.getBoundingClientRect().top + window.scrollY;
      const B = this._bounds(),
        TOTAL = B[B.length - 1];
      const yu = (y - top) / vh;
      if (yu <= 0.01 || yu >= TOTAL) return y; // hero top / footer region: leave as-is
      let best = B[0],
        bd = Infinity;
      B.forEach((b) => {
        const d = Math.abs(yu - b);
        // <= so ties snap forward: a label's marker-x maps exactly between two
        // boundaries, and the user aimed at the label's own scene
        if (d <= bd) {
          bd = d;
          best = b;
        }
      });
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(max, top + best * vh));
    };
    track.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
      moved = false;
      if (this._touch) {
        // navigation, not a gesture: never clamp it (mirrors anchor nav)
        this._gClampOn = false;
        this._gRange = undefined;
        this._assisted = true;
        return;
      }
      dragging = true;
      this._touchDown = true; // holds the settle off while the finger is down
      try {
        track.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    track.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
      if (moved) {
        const y = yFor(e.clientX);
        if (y !== undefined) window.scrollTo(0, Math.round(y));
      }
    });
    const up = (e: PointerEvent) => {
      if (this._touch) {
        if (performance.now() - downT < 400 && Math.hypot(e.clientX - downX, e.clientY - downY) < 12) {
          const y0 = yFor(e.clientX);
          if (y0 !== undefined) {
            const y = snapB(y0);
            this._fly = undefined;
            this._assisted = true;
            this._gClampOn = false;
            this._gRange = undefined;
            try {
              window.scrollTo({ top: y, behavior: this._rm ? 'auto' : 'smooth' });
            } catch (err) {
              window.scrollTo(0, y);
            }
          }
        }
        return;
      }
      if (!dragging) return;
      dragging = false;
      this._touchDown = false;
      this._lastInT = performance.now(); // release starts the standard settle clock
      if (!moved) {
        const y0 = yFor(e.clientX);
        if (y0 !== undefined) {
          const y = snapB(y0);
          if (this._rm) window.scrollTo(0, y);
          else this._flyTo(y);
        }
      }
    };
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  }

  _updateIndex(vh: number) {
    const E = this._el;
    if (!E || !E.idx) return;
    const doc = document.documentElement;
    if (doc.scrollHeight - vh <= 0) return;
    // section boundaries + label centers measured once per resize/refit, not per frame
    if (!this._idxGeo) {
      const tun = this._tunnel,
        tech = this._techEl,
        about = E.about;
      const b1 = tun ? tun.offsetTop + tun.offsetHeight * 0.2 : 0;
      this._idxGeo = {
        W: E.idxFl.parentElement.clientWidth,
        xs: E.idxItems.map((it: HTMLElement) => it.offsetLeft + it.offsetWidth / 2),
        b1,
        b2: tech ? tech.offsetTop : b1,
        b3: about ? about.offsetTop : tech ? tech.offsetTop : b1,
        yEnd: doc.scrollHeight - vh * 0.5,
      };
    }
    const G = this._idxGeo;
    const y = window.scrollY + vh * 0.5;
    let a = -1;
    if (y >= G.b3) a = 2;
    else if (y >= G.b2) a = 1;
    else if (y >= G.b1) a = 0;
    if (a !== this._idxA) {
      const first = this._idxA === -1 && a === -1;
      this._idxA = a;
      E.idxItems.forEach((it: HTMLElement, i: number) => {
        it.style.color = i === a ? 'var(--ink)' : 'var(--idx-dim)';
      });
      if (!first) this._scrambleIndex();
    }
    // piecewise remap: box moves continuously, arriving at each label exactly when its section activates
    const seg = (v0: number, v1: number, x0: number, x1: number) =>
      x0 + (x1 - x0) * Math.min(1, Math.max(0, (y - v0) / Math.max(1, v1 - v0)));
    let target;
    if (y < G.b1) target = seg(0, G.b1, 0, G.xs[0]);
    else if (y < G.b2) target = seg(G.b1, G.b2, G.xs[0], G.xs[1]);
    else if (y < G.b3) target = seg(G.b2, G.b3, G.xs[1], G.xs[2]);
    else target = seg(G.b3, G.yEnd, G.xs[2], G.W);
    const prev = this._idxX || 0;
    this._idxX = this._rm ? target : prev + (target - prev) * 0.15;
    if (Math.abs(target - this._idxX) < 0.3) this._idxX = target;
    if (this._idxX === prev && this._idxDrawn === this._idxX) return; // marker at rest — no writes
    this._idxDrawn = this._idxX;
    this._idxR = (this._idxR || 0) + (this._idxX - prev) * 0.55; // tumble only while moving
    E.idxBx.style.transform = 'translateX(' + this._idxX.toFixed(1) + 'px) rotate(' + this._idxR.toFixed(1) + 'deg)';
    E.idxFl.style.transform = 'scaleX(' + (this._idxX / G.W).toFixed(4) + ')';
  }

  // riser type: fit each [data-abfit] line edge-to-edge; data-fit-group lines share the smaller size
  _fitAbout() {
    // batched: write all probe sizes, read all measurements, then write final sizes (no layout thrash)
    const els = [...document.querySelectorAll('[data-abfit]')] as (HTMLElement & { _fs?: number })[];
    els.forEach((el) => {
      el.style.fontSize = '100px';
    });
    const groups: Record<string, (HTMLElement & { _fs?: number })[]> = {};
    els.forEach((el) => {
      const target = el.parentElement!.clientWidth;
      const w = el.scrollWidth;
      el._fs = w > 4 && target > 4 ? (100 * target) / w : 0;
      const g = el.dataset.fitGroup;
      if (el._fs && g) (groups[g] = groups[g] || []).push(el);
    });
    Object.values(groups).forEach((gr) => {
      const min = Math.min.apply(
        null,
        gr.map((e) => e._fs!)
      );
      gr.forEach((e) => {
        e._fs = min;
      });
    });
    els.forEach((el) => {
      if (el._fs) el.style.fontSize = el._fs.toFixed(2) + 'px';
    });
  }

  _update() {
    if (this._rotLock) return; // rotate lock: freeze the whole pipeline
    const vh = this._vh();
    this._scrollStep(vh);
    const abW = window.innerWidth;
    // the riser cap (max-width: 167.1vh) makes the giant fit height-dependent;
    // desktop re-fits on height changes too. Touch keeps width-only (browser
    // chrome collapse jitters innerHeight on every scroll reversal there).
    const abH = this._touch ? 0 : window.innerHeight;
    if (this._abW !== abW || this._abH !== abH || this._abRefit) {
      this._abW = abW;
      this._abH = abH;
      this._abRefit = false;
      this._fitAbout();
      this._idxGeo = null;
      this._hlGeo = null;
      this._beltGeo = null;
      this._forceScene = true; // cached layout re-measured
      if (!this._abFontsWait) {
        this._abFontsWait = true;
        try {
          document.fonts.ready.then(() => {
            this._abRefit = true;
          });
        } catch (e) {}
      }
    }
    if (!this._phSynced) this._syncPallet(this._styleI); // hero mounts async; seed it with this visit's random style
    if (!this._scrubSynced) {
      if (this._el.exp) {
        this._scrubSynced = true;
        this._syncScrub();
        setTimeout(() => this._prefetchScrubs(), 4000);
      }
    } // seed scrub with this visit's random accent; prefetch the rest once idle
    if (!this._spSynced) this._syncSpray(this._styleI); // spray mounts async too; same shared index
    this._updateIndex(vh);
    const root = this._tunnel;
    if (!root) return;
    // idle gate: everything below is a pure function of (scroll, viewport); once the
    // exact same settled scroll state has been painted, skip all scene reads/writes
    const yKey = this._rm ? window.scrollY : this._sy;
    const settled = this._rm || (this._sy === this._st && !this._fly);
    // card expand/collapse is a click-driven CSS transition with no scroll change:
    // hold the gate open while one is live so obstacle rects track the animation
    if (
      !this._forceScene &&
      settled &&
      !this._qAnim &&
      yKey === this._scenePainted &&
      this._vs === this._vsPainted &&
      !(this._obsAnimUntil && performance.now() < this._obsAnimUntil)
    )
      return;
    this._scenePainted = settled ? yKey : undefined;
    this._vsPainted = this._vs; // sprayVis reads last frame's _vs; repaint once more when it moves
    this._forceScene = false;
    const E = this._el;
    const clamp01 = this._c01,
      easeIO = this._easeIO;
    const rect = root.getBoundingClientRect();
    // spray reveal is delayed: the navy dissolve first lands on the plain
    // background, then the spray fades in right before the accent knockout
    const sprayWrap = E.sprayWrap;
    const sprayVis = Math.max(easeIO(clamp01((this._vs - 0.5) / 0.4)), rect.bottom < vh + 10 ? 1 : 0);
    if (sprayWrap) sprayWrap.style.opacity = sprayVis.toFixed(3);
    if (this._spray) this._spray.paused = sprayVis < 0.01;
    if (rect.bottom < -10) return;
    // ---- timeline: every transition scrubbed directly from scroll.
    // 1 unit = 100vh. Boundaries are the only rest states; the global settle
    // in _scrollStep commits to them. No per-section physics.
    const B = this._bounds(),
      TOTAL = B[B.length - 1];
    const yu = Math.min(Math.max(-rect.top / vh, 0), TOTAL);
    const seg = (i: number) => {
      const p = clamp01((yu - B[i]) / (B[i + 1] - B[i]));
      return this._rm ? (p < 0.5 ? 0 : 1) : p; // reduced motion: resolved states only
    };
    const hh = E.heroHint;
    if (hh) hh.style.opacity = yu < 0.15 ? '1' : '0';
    const u0 = seg(0); // unified event: converge + explosion
    const hlConv = easeIO(clamp01(u0 / 0.28)); // headline converges first…
    const qRaw = clamp01((u0 - 0.25) / 0.75); // …then the explosion carries through
    // touch: native scroll is quantized — smooth the explosion scrub across frames
    let q = qRaw;
    if (this._touch && this._qSm !== undefined) {
      q = this._qSm + (qRaw - this._qSm) * 0.28;
      if (Math.abs(q - qRaw) < 0.001) q = qRaw;
    }
    this._qSm = q;
    this._qAnim = q !== qRaw; // keeps the idle gate open while the scrub converges
    this._qNow = q;
    // transition at rest — adopt the current accent's scrub for the next pass
    const atRest = q <= 0.001 || q >= 0.999;
    if (atRest && !this._qRest) this._syncScrub();
    this._qRest = atRest;
    // value-prop wheel: continuous across 3 short segments; detents = boundaries
    let wt = (Math.min(Math.max(yu, B[1]), B[4]) - B[1]) / (B[4] - B[1]);
    if (this._rm) wt = Math.round(wt * 3) / 3;
    const bx = seg(4); // belt exit: messages slide off left, video remains
    const d = seg(5); // deployments reveal (unified: fade + message + handshake)
    const f1 = seg(6),
      f2 = seg(7); // fly transitions to tech / about
    const pr = seg(8); // contact riser
    // opening-gesture jets (same pair as spray boot/reset) fire once as each fly ignites
    const jets = () => {
      if (!this._spray || !this._spray.nudge) return;
      const W = window.innerWidth;
      this._spray.nudge(W * 0.25, vh * 0.5, 600, 150, 4);
      this._spray.nudge(W * 0.75, vh * 0.55, -500, -120, 4);
    };
    if (f1 > 0.02 && !(this._f1Prev > 0.02)) jets();
    this._f1Prev = f1;
    if (f2 > 0.02 && !(this._f2Prev > 0.02)) jets();
    this._f2Prev = f2;
    // Tech -> About dolly refreshes the field (site feedback): a vertical spawn
    // curtain sweeps across with the transition, re-emitting a pool fraction
    // equal to the progress delta. Slots are overwritten oldest-first, so by
    // the time About lands ~the whole pool has been re-seeded — old grains
    // vanish as new ones fade in, like a fresh start. Same per-frame burst
    // machinery that already runs, so no extra cost and no reset hitch. The
    // per-frame cap keeps anchor fly-throughs from dumping clumps.
    if (this._spray && this._spray.emit && f2 > 0.001 && f2 < 0.999) {
      const df2 = Math.abs(f2 - (this._f2Re === undefined ? f2 : this._f2Re));
      if (df2 > 0) {
        const W = window.innerWidth;
        const cx = W * f2;
        this._spray.emit(cx, vh * 0.12, Math.min(df2, 0.05), 0.06, cx, vh * 0.88);
      }
    }
    this._f2Re = f2;
    // deployments handshake: fire the opening jets the moment the spray surfaces,
    // so the cross-current reads as part of the reveal transition (not after it)
    if (sprayVis > 0.35 && !(this._svPrev > 0.35) && d > 0.2) jets();
    this._svPrev = sprayVis;
    const scenes = E.scenes;
    if (!scenes[0]) return;

    const fly = [q, easeIO(f1), easeIO(f2), 0];
    const births = [0, 1, 0.45, 0.45];

    const setScene = (i: number) => {
      const scene = scenes[i];
      const b = births[i];
      const inFly = i === 0 ? 1 : fly[i - 1];
      const outFly = fly[i] || 0;
      const s = (i === 0 ? 1 : b + inFly * (1 - b)) + (i === 0 ? 0 : outFly * 1.3);
      const frame = E.frames[i];
      // hero dissolves fast as the explosion ignites (lab plate timing)
      const past = i === 0 ? easeIO(clamp01((outFly - 0.03) / 0.15)) : clamp01((s - 1.04) / 1.1);
      const behind = b >= 0.999 ? 0 : clamp01((1 - s) / (1 - (b || 0.45)));
      const born = i < 2 ? 1 : clamp01(inFly / 0.16);
      scene.style.transform = 'translateZ(0) scale(' + s.toFixed(4) + ')';
      scene.style.opacity = String((1 - Math.pow(past, 1.5)) * born);
      scene.style.visibility =
        (i >= 2 && inFly <= 0.001) || (i !== 0 && s < b - 0.001) || past >= 1 ? 'hidden' : 'visible';
      if (frame && i !== 0) frame.style.borderRadius = (behind * 5.5).toFixed(2) + 'vh';
      return { s, past, inFly, grow: i === 0 ? 1 : easeIO(clamp01((s - b) / (1 - b))) };
    };

    const st = scenes.map((_: unknown, i: number) => setScene(i));
    // hero sim runs only while its scene can be seen (it keeps its own IO + hidden-tab gates)
    if (this._pallet) this._pallet.paused = st[0].past >= 1;
    this._syncCardObstacles(st[2]);

    // ---- about riser: headline + email surface from below; statement lifts ----
    if (scenes[3]) {
      const rp = easeIO(clamp01((pr - 0.3) / 0.7));
      const giant = E.abgiant;
      if (giant) {
        giant.style.transform = 'translateY(' + ((1 - rp) * 115).toFixed(2) + '%)';
        // the rising headline pushes the spray field upward along its top edge
        if (this._spray && this._spray.nudge && rp > 0.001 && rp < 0.999) {
          const gr = giant.getBoundingClientRect();
          const prev = this._abTop === undefined ? gr.top : this._abTop;
          const vy = prev - gr.top; // px per frame, + = moving up
          this._abTop = gr.top;
          if (vy > 0.4 && gr.top < vh) {
            const fy = Math.min((vy / vh) * 2600 * 0.9, 65);
            // one jet per letter of "TELL US ABOUT", at each letter's live position
            const line = giant.querySelector('[data-abfit]:not([data-gw])');
            const tn = line && line.firstChild;
            if (tn && tn.nodeType === 3) {
              const range = document.createRange();
              const txt = (tn as Text).textContent || '';
              const mid = gr.left + gr.width / 2;
              for (let k = 0; k < txt.length; k++) {
                if (txt[k] === ' ') continue;
                range.setStart(tn as Text, k);
                range.setEnd(tn as Text, k + 1);
                const cr = range.getBoundingClientRect();
                if (!cr.width) continue;
                const cx = cr.left + cr.width / 2;
                this._spray.nudge(cx, cr.top, ((cx - mid) / gr.width) * fy * 0.5, fy, 1.1);
              }
            }
          }
        } else this._abTop = undefined;
      }
      const msg = E.abmsg;
      if (msg) {
        const m = easeIO(clamp01(pr / 0.65));
        if (this._touch) {
          // lift so the statement centers in the space left above the risen contact
          // block (min 72px below the fixed header), balancing top gap and block gap
          const gTop = vh - vh * 0.05 - giant.offsetHeight; // giant's final top
          const H = msg.offsetHeight;
          const wantTop = Math.max(72, (gTop - H) / 2);
          // never less than the clearance lift: bottom must stay 20px above the block
          const L = Math.max(0, vh / 2 - H / 2 - wantTop, vh / 2 + H / 2 - (gTop - 20));
          msg.style.transform = 'translateY(-50%) translateY(' + (-m * L).toFixed(1) + 'px)';
          msg.style.opacity = '1';
        } else {
          // DC motion: lift 24vh, shrink to 0.6 — plus a clearance guard (site
          // feedback): the riser headline is fit-to-width, so on short/wide
          // viewports it grows tall enough to collide with the statement.
          // Keep >= 28px above the rising block (mirror of the mobile
          // clearance rule): lift the statement further first, and only
          // shrink it beyond the DC scale if the header clamp binds.
          const H = msg.offsetHeight;
          const Hg = giant.offsetHeight;
          let s = 1 - 0.4 * m;
          let ty = -0.24 * vh * m;
          let top = vh / 2 - H / 2 + ty;
          const giantTopNow = vh - 0.05 * vh - Hg + (1 - rp) * 1.15 * Hg;
          const limit = giantTopNow - 28;
          if (top + s * H > limit) {
            const lift = Math.min(top + s * H - limit, Math.max(0, top - 96));
            ty -= lift;
            top -= lift;
            if (top + s * H > limit && limit - top > 12) s = Math.max(0.35, (limit - top) / H);
          }
          msg.style.transform = 'translateY(-50%) translateY(' + ty.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
          msg.style.opacity = '1';
        }
      }
    }

    const proofFilm = E.film;
    // ---- explosion scrubbed by q; proof cross-dissolves in through screen-blend
    const exp = E.exp;
    if (exp) {
      if (!exp.paused) exp.pause();
      if (q > 0.001 && q < 0.999) {
        if (exp.readyState >= 1 && exp.duration && !exp.seeking) {
          const tt = q * exp.duration * 0.995;
          if (Math.abs((exp.currentTime || 0) - tt) > 0.02) exp.currentTime = tt;
        }
        // holds near-full opacity long: proof glows through the bright particles
        exp.style.opacity = (clamp01(q / 0.05) * (1 - easeIO(clamp01((q - 0.8) / 0.2)))).toFixed(3);
      } else exp.style.opacity = '0';
    }
    const pin = easeIO(clamp01((q - 0.52) / 0.36));
    // grade bridge: proof arrives tinted toward the LIVE accent (var(--acc)), settles to native
    const gradeEl = E.grade;
    if (gradeEl) gradeEl.style.opacity = (pin * (1 - easeIO(clamp01((q - 0.88) / 0.12))) * 0.5).toFixed(3);
    // decode only when visible: paused while occluded by the hero or after the navy dissolve
    if (proofFilm && !this._rm) {
      const wantPlay = q > 0.4 && this._vs < 0.999;
      if (wantPlay && proofFilm.paused) {
        const p = proofFilm.play();
        if (p && p.catch) p.catch(() => {});
      } else if (!wantPlay && !proofFilm.paused) proofFilm.pause();
    }

    const l0 = E.l0;
    const l1 = E.l1;
    if (l0 && l1) {
      const BASE = 3;
      const g1 = hlConv;
      const g2 = fly[0];
      if (this._touch) {
        // vertical converge to a centered stack (portrait)
        const gap = Math.max(vh * 0.012, 14);
        if (!this._hlGeo)
          this._hlGeo = {
            h0: l0.offsetHeight / BASE,
            h1: l1.offsetHeight / BASE,
            c0: l0.offsetTop + l0.offsetHeight / 2,
            c1: l1.offsetTop + l1.offsetHeight / 2,
          };
        const h0 = this._hlGeo.h0,
          h1 = this._hlGeo.h1;
        const c0base = this._hlGeo.c0;
        const c1base = this._hlGeo.c1;
        const c0start = Math.min(vh * 0.17 + h0 / 2, vh * 0.5 - gap / 2 - h0 / 2);
        const c1start = Math.max(vh * 0.83 - h1 / 2, vh * 0.5 + gap / 2 + h1 / 2);
        const colH = h0 + gap + h1;
        const c0target = (vh - colH) / 2 + h0 / 2;
        const c1target = (vh - colH) / 2 + h0 + gap + h1 / 2;
        // converge vertically to the centered stack, then fade out in place (no grow / fly-out)
        const cy0 = c0start + (c0target - c0start) * g1;
        const cy1 = c1start + (c1target - c1start) * g1;
        l0.style.transform = 'translateY(' + (cy0 - c0base).toFixed(1) + 'px) scale(' + (1 / BASE).toFixed(4) + ')';
        l1.style.transform = 'translateY(' + (cy1 - c1base).toFixed(1) + 'px) scale(' + (1 / BASE).toFixed(4) + ')';
      } else {
        const W = window.innerWidth;
        const gap = Math.max(W * 0.012, 14);
        if (!this._hlGeo)
          this._hlGeo = {
            w0: l0.offsetWidth / BASE,
            w1: l1.offsetWidth / BASE,
            c0: l0.offsetLeft + l0.offsetWidth / 2,
            c1: l1.offsetLeft + l1.offsetWidth / 2,
          };
        const w0 = this._hlGeo.w0,
          w1 = this._hlGeo.w1;
        const c0base = this._hlGeo.c0;
        const c1base = this._hlGeo.c1;
        const c0start = W * 0.05 + w0 / 2;
        const c1start = W * 0.95 - w1 / 2;
        const rowW = w0 + gap + w1;
        const c0target = (W - rowW) / 2 + w0 / 2;
        const c1target = (W - rowW) / 2 + w0 + gap + w1 / 2;
        // converge to the centered row, then fade out in place (no grow / fly-out)
        const cx0 = c0start + (c0target - c0start) * g1;
        const cx1 = c1start + (c1target - c1start) * g1;
        l0.style.transform =
          'translateY(-50%) translateX(' + (cx0 - c0base).toFixed(1) + 'px) scale(' + (1 / BASE).toFixed(4) + ')';
        l1.style.transform =
          'translateY(-50%) translateX(' + (cx1 - c1base).toFixed(1) + 'px) scale(' + (1 / BASE).toFixed(4) + ')';
      }
      const tfade = easeIO(clamp01(g2 / 0.1));
      l0.style.opacity = (1 - tfade).toFixed(3);
      l1.style.opacity = (1 - tfade).toFixed(3);
      const vis = g2 >= 0.999 ? 'hidden' : 'visible';
      l0.style.visibility = vis;
      l1.style.visibility = vis;
    }
    // ---- value props: plain scrubbed wheel; the global settle provides the detents ----
    const beltFade = 1 - easeIO(clamp01(d / 0.25));
    const belt = this._beltEl;
    if (belt) {
      belt.style.opacity = beltFade.toFixed(3);
      const WW = window.innerWidth;
      const gapB = WW * 0.24;
      const stageRight = WW * 0.94;
      const els = E.cms;
      if (els.every(Boolean)) {
        if (!this._beltGeo) this._beltGeo = { w: els.map((el: HTMLElement) => el.offsetWidth) };
        const w = this._beltGeo.w;
        const pos = [0, w[0] + gapB, w[0] + gapB + w[1] + gapB];
        const lockX = w.map((wk: number, k: number) =>
          k === 2 ? Math.min(stageRight - w[0], stageRight - wk) : stageRight - w[0]
        );
        const lockPos = pos.map((p, k) => p - lockX[k]);
        const offs = [pos[0] - WW - 40, lockPos[0], lockPos[1], lockPos[2]];
        const u2 = wt * 3,
          k0 = Math.min(Math.floor(u2), 2),
          frB = u2 - k0;
        let offset = offs[k0] + (offs[k0 + 1] - offs[k0]) * frB;
        // belt exit: keep sliding left until the last message clears the frame
        if (bx > 0) offset += easeIO(bx) * (pos[2] + w[2] + 60 - offs[3]);
        for (let i = 0; i < 3; i++) {
          const el = els[i];
          const x = pos[i] - offset;
          const stageX = lockX[i];
          const ff = 1 - clamp01(Math.abs(x - stageX) / (gapB + w[i] * 0.5));
          el.style.transform = 'translateX(' + x.toFixed(1) + 'px) translateY(-50%)';
          const e2 = ff * ff * (3 - 2 * ff);
          E.cmFill[i].forEach((n: HTMLElement) => {
            n.style.opacity = e2.toFixed(3);
          });
          E.cmOut[i].forEach((n: HTMLElement) => {
            n.style.opacity = (1 - e2).toFixed(3);
          });
          el.style.visibility = x < -w[i] - 40 || x > WW + 40 ? 'hidden' : 'visible';
        }
      }
    }

    // deployments: shift clock → knockout → navy dissolve
    const ko = E.ko;
    if (ko) {
      const pastFade = clamp01(1 - st[1].past * 3);
      const kq = easeIO(clamp01((d - 0.08) / 0.42)); // knockout, scrubbed from deploy segment
      ko.style.opacity = (kq * pastFade).toFixed(3);
      const kt = E.kt;
      kt.style.opacity = (kq * pastFade).toFixed(3);
      kt.style.transform = 'scale(' + (0.72 + 0.28 * kq).toFixed(4) + ')';
      const vsS = clamp01((d - 0.45) / 0.55); // film → navy dissolve, scrubbed
      // fresh spray field each time we re-enter the reveal
      if (vsS > 0.02 && !(this._vsPrev > 0.02) && this._spray && this._spray.reset) this._spray.reset();
      this._vsPrev = vsS;
      this._vs = vsS;
      const vs = easeIO(vsS);
      if (proofFilm) proofFilm.style.opacity = Math.min(pin, 1 - Math.max(kq * pastFade, vs)).toFixed(3);
      // the frame's navy dissolves with the film, revealing the spray current behind
      const navyEl = E.navy;
      if (navyEl) navyEl.style.opacity = (1 - vs).toFixed(3);
      const solid = E.solid;
      // accent knockout lands after the spray has been introduced
      const sAcc = easeIO(clamp01((this._vs - 0.62) / 0.38));
      solid.style.opacity = (sAcc * pastFade).toFixed(3);
      solid.style.transform = 'scale(' + (0.94 + 0.06 * Math.max(kq, vs)).toFixed(4) + ')';
    }
  }
}

const boot = () => new FSPage();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
