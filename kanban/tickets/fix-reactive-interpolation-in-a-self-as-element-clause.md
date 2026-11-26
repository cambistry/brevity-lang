---
status: inbox
created: 2026-11-26
---
# Fix: reactive interpolation in a `self as` element clause fails with an internal error

```brevity
use HTML::div
TextDiv = (initial Text) *{
  text *Text = initial
  self as HTML::div = -> <div>{{ text }}</div>
}
@go = -> 1
```

Problem: with the HTML document in `remotes`, this fails on js, browser, rust and erlang with "Unexpected DomConstructor child: interp", which is an internal codegen error. With `{ text }` instead, it compiles (as literal text).

Expected: `{{ text }}` inside a `self as` clause's element is a reactive hole, as it is in element content elsewhere.

Found in `retire-constructor-return-as-findings`.
