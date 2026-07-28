/* Single page-wide rAF ticker: the page scroll/scene pipeline and both hero
   components subscribe to one loop (first definition wins — kept on `window`
   so the singleton survives any duplicate module evaluation). */

export interface Ticker {
  add(fn: (t: number) => void): void;
  remove(fn: (t: number) => void): void;
  _subs: Set<(t: number) => void>;
}

declare global {
  interface Window {
    __fsTicker?: Ticker;
  }
}

export function getTicker(): Ticker {
  if (!window.__fsTicker) {
    const subs = new Set<(t: number) => void>();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      subs.forEach((f) => f(t));
    };
    requestAnimationFrame(loop);
    window.__fsTicker = {
      add: (f) => {
        subs.add(f);
      },
      remove: (f) => {
        subs.delete(f);
      },
      _subs: subs,
    };
  }
  return window.__fsTicker;
}

/* Device tier: the whole site forks on input capability (hover+wheel vs
   coarse pointer), not user agent. The inline head script stamps `touch` on
   <html> from `(pointer: coarse)` (with a ?input=touch|fine override for
   tuning on desk); everything — CSS, page logic, hero budgets — keys off it. */
export const IS_TOUCH = document.documentElement.classList.contains('touch');
