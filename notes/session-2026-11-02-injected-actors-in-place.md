# Session 2026-11-02: injected actors, and new actors used in place

DI answers "who can I talk to?", not "what can I build?". A bare header entry is an actor, already
there. `#`, or a declared constructor, is something to construct one from. A new actor no longer has
to be bound before it's used.

## Behaviour

```brevity
*
  "svc.bv": Svc
*

read = (w) { return w.get() }

@a = { return Svc.Counter(5, step: 2).get() }             // a chain
@b = { return Svc.Counter(5, step: 2) }                   // a return
@c = { return read(Svc.Counter(5, step: 2)) }             // an argument
@d = { return Svc.Counter(Svc.Counter(1, step: 1).get(), step: 2).get() }
```

```
→ { id: "1", op: [[5, { step: 2 }], "#new"], to: "Svc @Counter" }
← { id: "1", re: "#<Svc @Counter/1>", 'bv-a': "#<Svc @Counter>" }
→ { id: "2", op: "@get", to: "Svc @Counter/1" }
```

| Header entry | Meaning | `Svc()` | `Svc.x()` |
|---|---|---|---|
| `"svc.bv": Svc` | an actor to talk to | error | yes |
| `"svc.bv": Svc { … }` | the same, with an inline interface | error | yes |
| `"svc.bv": Svc #` | something to construct from | yes | error |
| `"svc.bv": Svc () -> *{ … }` | the same, with a declared constructor | yes | error |

`s.W()` works in the same positions, on a constructed `s`, and asks that instance.

`p Svc::Point = …` parses and resolves through `Svc`'s doc. A wrong type or an alias not in the
header is a compile error. `w Svc::W` is refused when `W` is a class: `::` names types, so write
`w W`.

## Decisions

- **A declared constructor follows the `#` rule.** The parser's comment called it "constructor +
  service", but no test messaged one directly, so it's one rule rather than three.
- **An entry with no doc isn't checked.** `"/services/pair": Pair` then `Pair(…) as Pair` names an
  imported type, and only `extract` or a coercion gets that far without a doc.
- **The `*` on header entries stays gone.** `d00bc1f` removed it as noise, so bare means "an actor
  you can message". `Svc *` doesn't parse.
- **A nested construction outside a function is still `Bind the new 'W' first`.** File init can't
  wait for a reply mid-expression. That covers `s.W()` at file level too.

## Code

- **`src/public_classes.js`:** lowers a construction wherever it appears, checks header kinds
  (`checkHeaderKind`) and qualified types (`checkQualifiedType`). The `alias::name` branch of
  `namesClass` is gone.
- **`src/chains.js`:** `lowerChains` takes its receiver test and temp prefix.
  `lowerConstructionChains` uses it on every target, including JS, so a call on a new actor is a
  call on a bound name. A call passed as a construction's arg is hoisted too.
- **`viaInstance` in expressions:** all three backends now send an in-place `s.W()` to `s`.
- **`inferActorParams`:** an untyped param of a private function takes a class of this file when every
  caller passes one of that class. Rust and Erlang have to know at compile time that a param holds
  an in-process actor rather than an address. JS tells them apart at runtime.
- **`ast.remoteClassNames`:** every class named in a doc. A param typed as one holds an address.

## Older bugs, fixed here

- **`Counter(…).get()` from `(:Counter)`:** JS sent `@get` with `to: undefined`, and it crashed the
  Erlang compiler (`erlString`). The ticket had this down as working everywhere.
- **A call on an untyped param:**
  - JS returned an unawaited promise from `return w.get()`. It only worked when some other function
    had a local that happened to be called `w`, since `actorish` in `as_check.js` is a file-wide set
    of names.
  - Rust and Erlang sent `to: "w"`, the variable's name. Untyped params now count as holding an
    address.
- **`return b.who()` on a param typed as a class:** the same unawaited promise on JS. Existing tests
  wrote `t Text = b.who()` first, so they never hit it.
- **An actor passed to a param typed as a class from another file:** `(w Counter)` was refused,
  `'Svc.Counter' is not assignable to 'Counter'`.
- **A remote call as a construction's arg:** `Svc.Counter(a.get(), step: 2)` sent `{}` on JS.
- **Positional `return p.x`:** the parser built a `DotAccess` node no backend handles, even for a
  type in the same file. `return a: p.x` was fine. `AST.dotAccess` is gone.
- **Rust, a dep construction in a branch:** the local wasn't recorded as an actor, so the next call
  went to `"new_tmp0"` and didn't wait.
- **`typeLength`** didn't count `::`, so `p Svc::Point = …` was read as a declaration with no value.

## Tests

`__tests__/classes/public_class_across_files.test.js`: wire steps for each position, the header
rules, qualified annotations, and end-to-end runs through the relay. The old `must be bound before
use` test is gone, because that rule is what changed. `__tests__/types/type_cross_module.test.js`
covers the parse.

## Known gaps

- **Hoisting moves a chain ahead of the rest of its statement.** In `f(g(), Svc.W().get())`, the `#new`
  and `.get()` go out before `g()`, and a chain on the right of a short-circuit runs regardless. Rust
  and Erlang chains already behaved this way. A chain as the statement's whole value is unaffected.
- **Ephemeral actors aren't cleaned up.** `Svc.W().get()` leaves the new actor registered on `Svc`,
  as `w = Svc.W()` does.
- **`p Point = Svc.origin()` with `p.x`:** on Rust and Erlang this is `Unsupported DotAccessExpr`,
  while `p Svc::Point` works. Existing behaviour.
- **Mixed callers on Rust and Erlang.** If a private function's untyped param gets `Box()` from one
  caller and `Other()` or an address from another, nothing is inferred, so it's treated as an address
  and an in-process actor won't be reached. JS handles this. Public functions aren't inferred either.
- **An unannotated `return f(…)` has no reply tag.** `re` arrives without `bv-a`, since no type is
  known. Annotating (`r Text = f(…)`) gives one.
- **`return w` gives a bare address.** The reply's `re` is `["Svc @Counter/1"]`, not `#<…>`, whether
  or not it was bound first. Left as it is.
