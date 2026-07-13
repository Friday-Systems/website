# Friday Systems — Directed Spine Test: Cut List (v2, retimed — CURRENT)

Matches the retimed export of `Directed spine test.mp4` (transitions at 3.3×).

## Master file specs

| Property | Value |
| :---- | :---- |
| Container / codec | MP4 / H.264 (yuv420p) |
| Resolution | 1440 × 1080 (4:3) — *test only; production spine frames for 16:9 full-bleed + mobile crops* |
| Frame rate | 30 fps (constant) |
| Total duration | 34.833 s |
| Total frames | 1045 (frames 0–1044) |
| Audio | None |
| Transition speed | 3.3× (1.233 s / 37 frames each) |

## Cut list (frame-accurate @ 30 fps) — with section mapping

| # | Segment | Type | Camera move | Start | End | Duration | Frames | **Serves site section** |
| :-- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1 | Clip 1 — Left | Source | Static | 0:00.000 | 0:09.300 | 9.300 s | 0–278 | **§2 Proof** |
| 2 | Transition A (3.3×) | AI-gen | Left → Back (~90°) | 0:09.300 | 0:10.533 | 1.233 s | 279–315 | §2→§3 boundary |
| 3 | Clip 2 — Back | Source | Static | 0:10.533 | 0:17.333 | 6.800 s | 316–519 | **§3 Value props** |
| 4 | Transition B (3.3×) | AI-gen | Back → Right (~90°) | 0:17.333 | 0:18.567 | 1.233 s | 520–556 | §3→§4 boundary |
| 5 | Clip 3 — Right | Source | Static | 0:18.567 | 0:24.500 | 5.933 s | 557–734 | **§4 Deployments** |
| 6 | Transition C (3.3×) | AI-gen | Right → Left (~180°) | 0:24.500 | 0:25.733 | 1.233 s | 735–771 | §4→§5 boundary |
| 7 | Clip 4 — Left (return) | Source | Static | 0:25.733 | 0:34.833 | 9.100 s | 772–1044 | **§5 Technology backdrop / settle** |

**Totals:** 34.833 s · 1045 frames · transitions = 10.6% of runtime · within doc 3's 30–36 s recommendation and doc 5 §4(d)'s 45 s cap. Frame math verified (contiguous, no gaps/overlaps).

## Scroll-mapping keyframes

- T-A: enters **9.300 s** (f279), settles **10.533 s** (f316)
- T-B: enters **17.333 s** (f520), settles **18.567 s** (f557)
- T-C: enters **24.500 s** (f735), settles **25.733 s** (f772)

Mapping rule (doc 3 §2): each section's scroll span maps to its segment's time range; the scroll gap between sections maps to the transition range.

## Notes for the real (production) version

1. §3 carries four staged value-prop messages — likely the longest scroll span; give its segment the longest duration (here it is nearly the shortest).
2. Frame for 16:9; capture wide enough for mobile vertical crops.
3. Replace or validate AI transitions per design review (gimbal transit moves are the real alternative — doc 4 §3.3).
