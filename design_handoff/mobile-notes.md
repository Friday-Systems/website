# Friday Systems — Mobile Adaptation Notes

Prototype: `Friday Systems - Mobile.dc.html` (390×844 target). Desktop main untouched.
Mobile hero forks: `heroes/pallet-hero-mobile.js`, `heroes/spray-current-mobile.js`.

## Decision log
| # | Section | Verdict | What changed | Traded away |
|---|---------|---------|--------------|-------------|
| 0 | Entrance loader | KEEP | none | — |
| 1 | Header | KEEP | logo 120→96px, padding 20/32→16/20 | — |
| 2 | Bottom index | ADAPT | item padding 6/2→16/6px (≥44px targets), gap 26→18px | larger dead zone at bottom |
| 3 | Hero hint | ADAPT | copy → "Tap and hold the pallet"; raised to bottom:96px (clears taller index) | copy deviates (describes input) |
| 4 | Pallet hero | ADAPT | tap=blast / long-press=attract kept (built-in); HOLD_MS 200→280ms; horizontal drag=stir via pan-y; portrait camera dolly-out (aspect<1 → ×up to 1.8); DPR cap 1.5; aria-label verbs → touch | no idle hover-stir until first touch |
| 5 | Explosion scrub | KEEP | none (touch hijack already scrubs it) | — |
| 6 | Value belt | ADAPT | --fs-belt floor 60→44px (13vw) so "PAYBACK UNDER" fits 390px | monumental scale |
| 7 | Deployments knockout | KEEP | --fs-ko floor 70→34px (9.5vw) | — |
| 8 | Spray current | ADAPT | drag=stir (scroll drag injects nudge along finger track), tap=burst, stationary long-press=pour; budget: particles 448²→320², sim 144→96, pressure iters 20→14, DPR 2→1.5 | slightly coarser field |
| 9 | Accent re-solve | ADAPT | pointerdown-anywhere → qualified tap (<10px, <300ms, released); long-press cycles at hold start (desktop parity: pour carries new color) | color snap at finger-up, not down |
| 10 | Tech cards | ADAPT (10a) | row→column accordion; width transitions→height (featured 44svh, collapsed 9.5svh); tap=feature; spray obstacles unchanged (rects still measured) | side-by-side comparison |
| 11 | About statement | ADAPT | same copy re-broken 2→6 fitted nowrap lines (readable fitted size) | desktop's 2-line rhythm |
| 12 | Contact riser | KEEP | email link +12px vertical padding (44px target) | — |
| 13 | Footer | KEEP | padding 40/32→32/20; links +12px padding | — |
| 14 | Scroll system | ADAPT | stage 100vh→100svh; touch fully hijacked (preventDefault touchmove): finger drag 1:1 through the shared lerp (0.32 while finger down, 0.09 settle), one gesture = one transition (clamped at its far boundary; new touch required for the next), flick lift-off commits the current transition via the settle glide — no native inertia | native scroll feel |
| 15 | Landscape phone | ADAPT | rotate-lock overlay (coarse pointer + landscape + height<500px): branded prompt pauses scroll pipeline, hold timers, both sims, videos; portrait return re-derives svh geometry and snaps to nearest scene boundary | landscape phone view (by design — portrait timeline doesn't degrade, it inverts) |
| — | Type tokens | ADAPT | --fs-hl 168px/24vw→96px/30vw (converged "MIXED + SOLVED." row ≈364px at 390); --fs-card 5.6vw; --fs-copy 3.6vw | — |

## Handoff notes (Build phase)
- **Input layer:** page owns one pointer pipeline — `pointerdown` records tap candidate; 280ms stationary timer starts pour (`spray.press`); `pointerup` <300ms & <10px = cycle + burst (press→release after 120ms). Any 10px move cancels. Pallet keeps its own canvas listeners (`touch-action: pan-y`); the two layers don't conflict because the pallet never preventDefaults vertical pans.
- **Stir wiring:** `_onTouchMove` calls `spray.nudge(x, y, dx·k, dy·k, 2.5)` with dy up-positive (spray convention), clamped ±900. `k` = `stirStrength` prop (default 30). Spray's internal window-pointermove stir may not fire during preventDefault'd touchmove on iOS — the explicit nudge is the guaranteed path; don't remove it.
- **Viewport:** scroll is fully hijacked (preventDefault touchmove), so browser chrome should never collapse and `window.innerHeight` stays ≈ svh. If Build adds any native-scroll escape hatch, re-derive scene math from `visualViewport.height`, not innerHeight.
- **Throttling (not implemented here, by design):** mobile budgets are hard-coded in the `-mobile` forks (particles 320², sim 96, iters 14, DPR 1.5 both components, pallet shadow map already 1024 on coarse pointer). Build phase: replace forks with device-tier detection in the shared components.
- **Reduced motion:** all desktop paths survive — scroll hijack disabled (native scroll), scenes snap to resolved states, videos hold poster frame, pallet renders static, spray static field. No mobile-specific additions needed.
- **Videos:** Tech/Proof/scrub mp4s are desktop encodes; serve ~720p mobile variants and shorter scrubs (seek granularity on mobile hardware decoders limits scrub smoothness).
- **Tweaks exposed on the DC:** `holdDelay` (ms), `stirStrength` — for tuning the grammar on real devices.
- **Rotate lock:** overlay = `[data-rotate]`; MQ `(orientation: landscape) and (max-height: 500px)` gated on coarse pointer, so landscape TABLETS pass through untouched. Unlock path snaps to nearest boundary (not raw px — boundaries move with the new svh). Tablets: portrait works today (vw clamps cap the type); landscape tablet functions but deserves one Build-phase tuning pass (tighter `--copy-w`, index spacing) — fork on input (touch grammar both orientations), don't route landscape tablets to the desktop build (it assumes hover + wheel).
