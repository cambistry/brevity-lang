# Test fixture consolidation plan

Goal: reduce per-test compilations by merging compatible `@handler` definitions
into shared scripts so `expectBehavior` calls target different ops on the same
compiled actor.

Constraints:
- Erlang codegen can't handle multiple `uses` declarations in one actor
- Erlang codegen can struggle with multi-op scripts containing constructor types
- User prefers per-test scripts in implicit_return.test.js (reverted merge)

## Completed

### Prior session
- constructors/delimited_form.test.js
- constructors/sugared.test.js
- constructors/wrapped.test.js
- cam/external_send.test.js
- cam/remote_instance.test.js
- keywords/uses.test.js
- keywords/constructs.test.js

### This session
- [x] `operators/semicolon.test.js` — 7 → 5 scripts
- [x] `keywords/repeat_while.test.js` — 7 → 1 shared stateful script
- [x] `keywords/emit.test.js` — 6 → 3 scripts (twoSubs kept separate: Erlang limit)
- [SKIP] `functions/implicit_return.test.js` — user reverted; prefers per-test scripts

## Remaining

### Batch 3 — smaller wins (~3-5 each)
- [SKIP] `marshal/capture.test.js` — can't merge (capture returns ALL state vars)
- [x] `functions/lineal_form.test.js` — 5 → 1 shared edgeCaseScript
- [x] `functions/single_expression.test.js` — 4 → 1 shared script
- [SKIP] `marshal/hydrate.test.js` — can't merge (different state var sets per test)
- [SKIP] `types/type_dependency.test.js` — can't merge (different uses declarations)
- [x] `functions/delimited_form.test.js` — 2 → 1 shared script
