---
created: 2026-11-25
---
# Fix: a `catch` label should exit through `over` and `reduce`

`over` and `reduce` run their body as a callback, so a label inside it is a non-local exit across a function boundary:

```brevity
catch #found {
  over haystack (item) {
    if (item == needle) #found(item)
  }
}
```

Problem: the JS lowering (`genCatchStatement`, `src/codegen/javascript/statements.js`) emits `_lbl_<name>_<n>: { … break … }`, and `break` can't leave the callback. Erlang already uses a tagged throw.

Expected: JS uses a thrown sentinel caught at the `catch`, and Rust the equivalent where iteration uses closures.

Spec: `notes/catch-2026-03-30.md`. Gap recorded in `notes/deferred-codegen-gaps-2026-11-24.md`. `__tests__/keywords/catch.test.js` tests `repeat while` and brace forms only.

Done when a bare and a value-carrying label exit from `over` and from `reduce` (nested too) pass on js, rust and erlang.
