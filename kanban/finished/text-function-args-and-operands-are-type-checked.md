---
created: 2026-11-27
---
# Fix: Text functions' args and arithmetic operands should be type-checked

A name's type is known, but what it's passed to isn't checked against it:

```brevity
@f = (n Integer) {
  t Text = Text.slice(n, 0, 1)    // compiles: n isn't Text
  k Integer = Text.size(n)        // compiles
  m Integer = n + true            // compiles
  return m
}
```

A bind is checked (`t Text = n` is an error), and so is a method on a class (`t.nope()`). List
functions check some args (`List.slice` an Integer start, `List.join` a Text separator,
`src/validate.js`), but `Text.*` and `Blob.*` don't check their subject, and `+ - * /` don't
check their operands.

Expected: on js, erlang and rust, a Text or Blob function given a value known not to be its type is
a compile error, and so is arithmetic on a value known to be neither a number nor Text (for `+`).
Unknown types (`Anything`, unannotated) stay accepted. This makes the misuse in
`lambda-params-take-their-types-from-the-slot` an error: a lambda's params now carry the slot's
types.

**Scope (2026-11-27):** `+` joins two Lists too (`[1] + [2]`, `core_types/list_methods.test.js`).
`Text.size(x)` keeps its namespace, so its subject is checked. Each Text and Blob function's other
args are checked as well: an index is an Integer, a needle or a joined value is the subject's type.
