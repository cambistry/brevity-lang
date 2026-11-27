---
created: 2026-11-26
---
# A maker's `<style>` should style the elements the same maker makes

Spec: notes/creator-from-calling-scope-2026-11-26.md (supersedes notes/add-trace-on-return-2026-11-14.md)

Want: a `<style>` written in a function or class body styles the elements that same scope builds, with no `for=` and no named link. Both `$new`s carry, in `from`, the address of the scope that made them. The HTML service stamps each element with its request's `from` (attribute name open, `creator` favoured). It treats a `<style>` `$new` as one adopted sheet scoped to `[creator="<that from>"]`, kept per `from`, so a later `<style>` from the same address replaces that sheet's text.

```brevity
factory = {
  <style>padding: 1rem; h2 { margin: 0; }</style>
  <div><h2>Hi</h2></div>
}
```

Both elements leave `factory`, so they get the same translated address wherever the app is mounted.

Possible single-expression form, if adjacent elements on one line parse greedily as a sequence (the earlier ones as statements, the last one as the value):

```brevity
factory = () -> <style>…</style><div>…</div>
```

Today: that form fails with `Expected a line break or ';' after a statement, got HTML_CONSTRUCTOR`. Elements on separate lines stay separate statements.

Decide:
- Greedy adjacent elements: is it a sequence with the last element as the value, or a fragment (a list of elements)? What happens to `<a/><b/>` outside a factory?
- How a receiver written in Brevity reads its request's `from` (no form exists yet).
- Which scope closures and `{{ }}` holes report (the enclosing named scope, so they still match the style).
- Which scope methods called after construction report (`C:make` or `C:1:make`).
- Where replies addressed to a function or class scope go, and whether `from` becomes reply-only.
- Which elements get stamped (all, or only where `creator` changes), and how bare declarations reach the root.

Depends on: a bare element statement inside a function body sending its `$new` (see the `Fix:` ticket on dropped element statements).

Speculative alternative (see the note's "Speculation" section): the style as a class relationship. `F = HTML::div ^ { <style>…</style> } ^ *{ … }`, where instances are the extended element, the singleton layer holds the sheet, and HTML scopes it by `ty`. The projection form (`self as HTML::div = -> <div>…</div>`) was considered; it is a wrapper.
