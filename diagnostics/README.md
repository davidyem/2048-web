# Safari input diagnosis

Baseline: 5c6803d. This directory is not loaded by the game. The investigation
branch contains a narrow Input clock fallback for zero/unavailable wheel timestamps.
It fixes a reproduced Safari WebDriver lock, not a proven physical-trackpad coverage bug.
No renderer, duration, gesture thresholds, calibration algorithm or CSS changes.

## Mac: delivery before recognition

1. Open the game with `?trace=1` in Safari. Complete calibration normally. Record Safari/macOS versions.
2. Paste all of `safari.js` into Web Inspector Console. Keep the game foreground when testing.
3. Without opening Inspector again, put the cursor in the area to test, press **M**,
   and perform exactly one physical gesture. M records the attempt without changing
   the game or resetting recognition. Repeat for occupied-cell, empty-cell, score,
   background, left, right, above-board, below-board. Leave at least one second
   between gestures. Then test rapid same-direction and opposite-direction gestures separately.
4. Immediately after a missed gesture, stop input and export
   `JSON.stringify(__safari2048.freeze(), null, 2)`. Include the intended physical direction.
   The attempt marker exists even when no wheel event was delivered.

For exploratory play without a known reproduction: play for 20–30 seconds, marking
attempts with M, leave the cursor still for several gestures and then move it.
Stop at the first failure. `__safari2048.mark('label')` is also available, but switching
focus to Inspector changes the application's cancellation state and is a confounder.

The wrapper adds no wheel listener in its default mode, avoiding changes to native
wheel event regions. `window-handler-enter` proves delivery to the existing window
capture listener. `window-handler-exit` records command count, cancellation and the
WheelGesture state. The trace includes recognized/locked/threshold/momentum reasons
and coordinator rejection reasons. `trusted: false` means a simulated DOM event.
A marked attempted gesture without handler records is evidence of absent delivery,
provided the page had focus and this exact gesture was physically performed.

Use `__safari2048.inspect(x,y)` to inspect hit-test targets and CSS at viewport coordinates.
Occupied tiles are normally skipped because `.tile-layer` inherits pointer-events:none.
The journal keeps 1024 raw records and 128 compact gesture summaries, plus focus,
visibility, arrival gaps, timestamp, calibration factor and rejection reasons.
`freeze()` restores the original handler and removes diagnostic listeners. Reload
also removes all instrumentation. `coverage.js` preserves the calibration factor.

## Reproducible Safari WebDriver checks

Use a dedicated automation session: this test replaces its board and calibration.
It does not automate physical contact with the trackpad. No dependency installation
or global MCP configuration is needed:

```sh
python3 -m http.server 8001 --bind 127.0.0.1
/usr/bin/safaridriver -p 4447
# In another terminal, after the two servers are running:
python3 diagnostics/safari-webdriver.py --output /tmp/2048-safari-matrix.json
node tests/input-clock.mjs
node tests/engine.mjs
```

`--session ID` reuses a dedicated session. `--url URL` selects an unchanged baseline
server; `--rounds 1` runs 36 cases, the default runs 108. Inspect `pass`, delivered
packets, coordinates, target/path, directions, logical commits, board and scroll.
The process retains the automation window for inspection and reloads after testing
to remove probes and restore Math.random. A completed report can contain failures;
read the counts rather than treating process exit as a pass.

Safari 27.2's native wheel Actions delivered trusted events with timestamp zero.
Baseline recognized only the first of 36 separated events; the clock fallback
passed 108/108 cases. This proves recovery for that event path only. Physical logs
had advancing timestamps and do not establish the same cause.

The harness adapts a measured WebDriver quirk: scrollDelta is treated as cumulative
state. `pause` on a wheel source or Release Actions can emit an inverse packet.
It uses cumulative deltas, waits outside Actions, releases before measurement, and
checks the actual received delta. This is a harness adaptation, not game logic.
The current [WebKit dispatcher source](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Automation/SimulatedInputDispatcher.cpp)
subtracts the preceding scrollDelta and notes that scroll interpolation is not implemented.
Do not interpret `duration` on this action as a physical swipe duration.

Without a momentum field, the recognizer still waits for 220 ms of silence after
the last wheel packet. An opposite packet after 80 ms is deliberately suppressed;
after 260 ms it is recognized. The [WebKit WheelEvent interface](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/WheelEvent.idl)
does not expose native contact/momentum phases. Re-arming on a larger delta, axis
reversal or pointer movement would risk restoring ghost commands and is not used.

Only AFTER recording default mode, call `__safari2048.phases()` to add passive probes
on window/document/html/body, capture and bubble. Adding listeners can itself alter
WebKit event regions; never treat this instrumented run as the clean baseline.

## Optional root-region experiment, not a proposed production change

On a fresh reload, paste the snippet, repeat the failing gesture, then call
`__safari2048.coverageProbe(true)`. Wait two frames (or one second), repeat at the
same coordinates. It installs empty non-passive listeners on html/body; no commands
are dispatched and no overlay or CSS change is made. Reload and repeat baseline A
again. If A fails, B works, and A fails again across multiple trials, send the logs.
Only then is root event-region registration a supported fix candidate. Test buttons,
calibration, all directions, single-command counts and page scroll before publishing.
`__safari2048.stop()` restores the handler and removes all probes. Reload is the
stronger cleanup when comparing browser-native region state.

## iPhone: pacing versus duration

Open `?trace=1&perf=1` on physical iPhone and inspect via Safari on Mac. Paste the
snippet and call `__safari2048.frames()`. Play short groups of 3–5 moves in a foreground tab,
including short/long moves and merges. Export each report immediately (the existing perf journal retains only 80 events). Repeat with Low
Power Mode off; record display/accessibility settings, device/OS/Safari version.
Do not infer iPhone behavior from desktop/mobile emulation.

Compare movement elapsed with the unchanged nominal 120 ms, inputToSchedule,
move-frame-opportunity, move-end and commit, and active rAF interval p50/p95/p99.
Uniform 16.7 ms intervals versus uniform 8.3 ms intervals suggest a different cadence,
not automatically jank. Outliers relative to each device's own median suggest
scheduling stalls. rAF is not proof of compositor presentation; use a Web Inspector
Timelines recording for rendering attribution. The perf panel and probes add overhead.

Touch direction is recognized on pointerup, so finger travel time is outside the
120 ms animation. Buffer waiting and 92/104 ms spawn/merge decorations can affect
perceived tempo; decorations do not delay acceptance of the next move. No conclusion
about changing duration or easing is justified before this physical-device record.
