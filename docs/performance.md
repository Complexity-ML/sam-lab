# Large graph performance budget

SAM LAB targets a production workbench of **300 cards and 420 edges** on a current Apple Silicon laptop. The interaction target is a 60 Hz frame budget (16.7 ms) for pan, zoom and card dragging.

## Repeatable fixture

`createLargeGraphFixture()` in `src/domain/performance.ts` generates deterministic, credential-free graphs. Its test prepares 300 cards, the associated edges and every elastic path with a 120 ms CPU budget. Inputs are capped at 1,000 cards to avoid accidental renderer exhaustion.

`profileLargeGraphInteractions()` measures the independent CPU work for a card drag update, all elastic paths, a 200-card minimap projection, and a complete pan/zoom projection. Every interaction stage must remain below the 16.7 ms frame budget. This keeps the regression signal repeatable in CI while the Chromium trace below measures actual painting and compositing on target hardware.

## Runtime protections

- React Flow renders only elements inside the viewport.
- Styled edge objects are memoized until lineage changes.
- The interactive minimap is disabled above 200 cards; pan and zoom remain available through the canvas controls.
- Prompt text is local to `AgentPrompt`, so typing does not update graph state.
- Reduced-motion users receive effectively instant transitions and animations.
- Undo history is debounced and bounded to 50 graph snapshots.

## Manual profiling procedure

1. Load the 300-card fixture in a development build.
2. Record 10 seconds in Chromium Performance while dragging a middle card, panning end-to-end and zooming from 0.35× to 1.45×.
3. Confirm interaction frames stay near 16.7 ms on the target machine and no long task exceeds 100 ms.
4. Repeat with the inspector open and while typing a 10-line agent request.
5. Record hardware, Electron version, median frame duration and longest task in the PR or release notes.

The automated CPU budget is a regression signal, not a substitute for the manual frame trace above.
