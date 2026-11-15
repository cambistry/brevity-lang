# `__add_trace__`: recording the scopes that return a new actor — 2026-11-14

Design, not implemented. How an actor (first: a DOM element) learns which programmatic scopes
produced it, so a service can expose that, e.g. HTML as a `trace` attribute for styling and
DevTools. Replaces the routes in `ctor-provenance-2026-11-09.md` (a `ctor` envelope key) and
makes `from-names-calling-scope-2026-11-14.md` unnecessary for this purpose.

## The rule

- **A class may present a method `__add_trace__`.** It is declared in the class's (or service's)
  interface like any other member. Opt-in: a class that doesn't declare it is never sent it.
- **When a Brevity function or constructor returns an actor that did not exist when its body
  started, BV must invoke `__add_trace__` on that actor,** passing the address of the returning
  scope. It doesn't matter where the actor was created: in this body, in a subcall, local or
  remote. It only has to be new since the body started.
- **BV knows to call it because it is in the interface** of the returned value's type.

```brevity
**
  HTML: (:div)
**

@template = -> <div>123</div>      // div is new: __add_trace__ with template
@component = -> @template()        // still new to component's body: __add_trace__ with component
@wrap = (el) -> el                 // el existed before wrap started: no call
```

On the wire, for `@template` (current address syntax):

```js
{ op: '$new', to: 'HTML div' }
{ re: '#<HTML div 123>', ty: 'HTML div' }
{ op: [['#<. template>'], '__add_trace__'], to: 'HTML div 123' }
```

`inner = <p>…</p>; return inner` is covered: the rule looks at when the actor came to exist, not
at where the construction is written, so the compiler never guesses which element is "the" result.

## On the receiver's side

The list is appended at the tail. **Adding an address already in the list moves it to the
tail.** So each scope appears once, at the position of its outermost return; innermost first,
outermost last.

- With mutual recursion (`f` → `g` → `f`, the inner `f` building the element), the list ends
  `[g, f]`: the head is then not the maker. Not a strong preference; ignoring the duplicate
  instead would keep the maker at the head.
- The receiver owns these semantics; BV only makes the call.

## Constructors

A constructor returns its own new actor, so `@make = -> Counter(5)` invokes `Counter`'s
`__add_trace__` if `Counter` declares one. `return <div>…</div>` inside a constructor block still
needs a meaning (today it drops the element on all three targets).

## The DOM consumer

HTML declares `__add_trace__` on its elements and keeps the list in an attribute, `trace`
(checked free of conflicts in Chromium 147: no HTML, SVG or MathML attribute or DOM property of
that name). Entries separated by spaces, matched with CSS `~=`, which needs addresses without
spaces: colon-separated per `opre-colon-separator-2026-11-14.md`
(`trace="main:template main:component"`), or a per-attribute encoding of today's space-separated
addresses.

## Not addressed yet

- Cost (one call per returning level) and ordering against the caller's own messages to the
  service. Accepted for now; remote method chaining may later fold the call in.
- How each target determines "did not exist when the body started".
