# A label exit through `over` and `reduce` (2026-11-26)

Supersedes the first section of notes/deferred-codegen-gaps-2026-11-24.md. Spec: notes/catch-2026-03-30.md.

A label in an `over` or `reduce` body exits to its `catch` across the function the body runs in:

```brevity
r Integer = catch #found {
  seen List[Integer] = over(xs) (x Integer) {
    if (x > limit) #found(x * 10)
    x
  }
  0
}
```

A function that exits a label it doesn't declare (src/codegen/label_exits.js) is generated inline, inside its `catch`, never lifted to a handler, so the label is in scope where it's emitted. Per target:

- **JS:** the exit inside the function throws `_BvLabelExit(label, value)`; the `catch` wraps its labeled block in a `try` that takes its own label's exit and rethrows any other. An exit in the catch's own function stays a `break`.
- **Erlang:** the exit is the catch's tagged `throw`, as in a sequential body.
- **Rust:** the `over` or `reduce` is a `for` loop over a copy of the list instead of an iterator closure, so `break 'label value` reaches the labeled block.
