# 2048 Web

A browser version of the classic 2048 puzzle, built with static HTML, CSS, and native JavaScript modules.

## Controls

- Use the arrow keys or WASD on a keyboard.
- Swipe on touch devices.
- Swipe with two fingers on a Mac trackpad. The game asks for a one-time direction calibration and remembers the setting in the browser.
- Select **New Game** to restart.

## Run locally

No installation or build step is required. From the project directory, start any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deployment

This is a static HTML/CSS/JavaScript application published directly from the repository root with GitHub Pages.

## Input and animation contract

A pointer swipe emits one direction on release (26 px minimum, dominant axis).
Cancellation and a second touch discard the swipe. Wheel input accumulates 20 px
on a dominant axis, then locks the whole series. Explicit `WheelEvent.momentum`
is ignored; returning from momentum to direct input can start a new series.
Otherwise, 220 ms of silence is required. This conservative fallback can combine
rapid physical gestures: wheel deltas alone cannot identify finger contact.
Calibration retains the existing saved physical-direction mapping.

The coordinator keeps at most one pending direction, replacing it with newer
intent and discarding it after 80 ms. A rejected/unchanged command never spawns a
tile. Rules, score and exactly one spawn commit when a move is accepted; the
renderer then presents that transaction with a shared 120 ms WAAPI timeline.
Merge values and spawn appear together at movement completion. Decorative pulses
do not block input and are cancelled by the next movement. Reset invalidates the
session and cancels the animation batch. Visibility loss discards pending input,
settles the accepted transaction, and flushes persistence.

## Reproducible checks

```sh
node tests/engine.mjs
python3 -m http.server 8000
```

Open `http://localhost:8000/?trace=1` in a foreground browser. In DevTools:

```js
await (await import('./tests/browser.js')).run()
__2048Debug.traceLog()
```

The browser suite changes the local game and best score. Use a disposable browser
profile. It covers pointer cancellation, rapid input, stale commands, reset,
merge/spawn, win/Continue/game over, persistence, sampled transform continuity,
and 2,000 renderer lifecycle cycles. The engine suite compares 50,000 seeded
boards with an independent numeric implementation.

`?trace=1` enables a 512-entry journal with browser timestamps, gesture IDs,
rejection/replacement reasons, logical commits, visual commits, and board/spawn
snapshots. It has no continuous frame sampler. `?perf=1` enables the optional
frame monitor; its frame-opportunity event is **not** proof of a presented frame.

For disposable renderer experiments, `tests/renderers.js` exports `compare()`.
It replaces the visible tile layer; reload afterwards. Run the same file against
a checkout of the baseline to compare its WAAPI renderer with the CSS, shared
WAAPI, shared rAF, and Canvas timing prototypes. Canvas is not a complete visual
replacement. These Chrome tests do not validate physical trackpad gestures,
Safari on iPhone, GPU presentation times, or a guaranteed refresh rate.
