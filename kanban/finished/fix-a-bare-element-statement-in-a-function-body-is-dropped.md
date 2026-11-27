---
created: 2026-11-26
---
# Fix: a bare element statement in a function body is dropped

Problem: in a braced function body, an element written as a statement sends no `$new`. Only the last element (the value) is built:

```brevity
use :style, :div = HTML
@f = {
  <style>p { x: 1; }</style>
  <div>a</div>
}
```

The generated JS for `f` sends only `HTML:div`. Binding the first element (`x = <style>…</style>`) sends both. At file level a bare element statement does send its `$new` (see `__tests__/html/style.dom.test.js`, notes/scoped-styles-2026-11-09.md). Seen on js; rust and erlang not checked.

Expected: an element statement is a construction with an effect and sends its `$new` wherever it is written, on all three targets. Nothing is dropped silently.
