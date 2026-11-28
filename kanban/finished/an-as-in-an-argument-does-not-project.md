---
created: 2026-11-27
---
# An `as` in an argument doesn't project

```brevity
use document
use HTML::div
TextDiv = *(initial Text) {
  text *Text = initial
  self as HTML::div = () -> <div>made</div>
}
@build. = {
  t = TextDiv("a")
  document.body().append!(t as div)
}
```

Fails: "'body.append!()' positional arg 1: 'TextDiv' is not assignable to 'HTML::Element'". The arg carries its `as` type (`typeNameEnc`), but the arg check (`checkClauseTypes`, src/validate.js) reads the expression's type. Reading the arg's `as` type there instead makes it compile, but then nothing is appended: the `as` on an arg isn't lowered to the projection at runtime, as a bind's is (`el = t as div` works, src/as_check.js).

Expected: `f(x as T)` passes x's projection to T, as `y = x as T; f(y)` does, on every target.

Related: in a class's projection, a `{{ }}` hole or an attribute expression (`<div id={ id }>`) fails in the browser build ("Unexpected DomConstructor child: interp", "Unexpected attr value type: interp").

**Scope (2026-11-27):** `f(x as T)`, `f(k: x as T)` and `o.m(x as T)` bind the arg first, as
`y = x as T` does (src/validate.js hoistArgAs); a plain call's and a named arg's `as` parse. Also
fixed on the way: rust `self as T` arms didn't build (`json!([{…}])`); rust sent a user-type arg in
its internal form; rust dropped a statement `if`'s last line; `c as T` for a child made in a branch
failed on every target.
