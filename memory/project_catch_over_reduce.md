---
name: catch with over/reduce
description: over and reduce take lambdas; catch label-exits can't cross those callback boundaries with the current labeled-break codegen
metadata:
  type: project
---
`over` and `reduce` are higher-order constructs: the body runs inside a callback, not a sequential block.

**Why:** `catch #label { over ... |item| { #label } }` can't use the JS labeled-`break` lowering (`genCatchStatement` in `src/codegen/javascript/statements.js` emits `_lbl_<name>_<n>: { … break … }`), because `break` can't cross a function boundary. Same for `reduce`. Phase 4 of `catch` hit this with `break _lbl_X` inside an async arrow iteratee; its tests were trimmed to `repeat while`/brace forms, and over+catch is deferred until a thrown-sentinel path exists. Still labeled-break only as of 2026-11-24.

**How to apply:** for `catch`, label refs, or any non-local exit through `over`/`reduce` (or any callback-taking construct), use a thrown sentinel + try/catch in JS, and the equivalent on Rust if iteration uses closures. Erlang already uses tagged throw.
