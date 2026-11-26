---
status: inbox
created: 2026-11-26
---
# Fix: binding an element projection gives a self-contradicting error

```brevity
use HTML::div
TextDiv = (initial Text) *{
  text *Text = initial
  self as HTML::div = -> <div>{ text }</div>
}
@go = { tdiv = TextDiv("a"); el div = tdiv; return 1 }
```

Problem: with the HTML document in `remotes`, the `self as` clause compiles on js, browser, rust and erlang, but nothing can bind the projection. `el div = tdiv`, `el HTML::div = tdiv` and `el = tdiv as div` all fail on every target with "'HTML::div' names a class, and '::' is for types — annotate it 'el div'" (src/public_classes.js:130). The suggested `el div` is the first form, and it fails the same way.

Expected: an element projection binds through an ordinary annotation or `as`. If a form really is wrong, its error names a form that works.

Found in `retire-constructor-return-as-findings`.
