---
status: inbox
created: 2026-11-03
---
# Untyped private params: replace caller-based actor inference; decide generics in signatures

Design: notes/generic-function-args-2026-11-03.md. "Generic-by-default" for private functions isn't a feature: inside a file the compiler sees every caller, so an untyped param can be inferred from what the callers pass, with the return typed per call site. Generics would matter only in cross-file signatures, and that is undecided.

## 1. Replace `inferActorParams`

`inferActorParams` (src/public_classes.js) gives an untyped param of a private function a class type when every caller it finds passes an actor of that one class from the same file.

```brevity
@Box = *{ @who = { return "x" } }

read = (b) { return b.who() }     // treated as (b @Box)

@go = { return read(@box()) }
```

It came in with the injected-actors work (notes/session-2026-11-02-injected-actors-in-place.md) without a design decision. An actor from the same file arrives as a local handle, a remote one as an address. JS checks which at runtime, in `#childSend`. Rust and Erlang decide at compile time, and treat an untyped param as an address unless inference applies.

What's wrong with it (from reading the code; reproduce first):

- **A distant edit breaks working code:** a second caller passing a different class or an address turns inference off. `read(@box())` then stops working on Rust and Erlang with no compile error, while JS keeps working.
- **It doesn't see every caller:** it reads only function bodies, so it misses calls from a constructor block and functions passed as values (`&read`). A missed caller passing an address could be sent down the in-process path.
- **It recognises only some arguments:** a direct `Box()`, or a local assigned from one with a plain `=`. An actor in a cell or a typed local turns inference off.
- **It barely has tests:** two cases in __tests__/classes/public_class.test.js cover where it works; none cover the cases above.

Options:

1. **Runtime check on Rust and Erlang, as on JS (recommended):** no call site affects another. Erlang looks easy (a handle is a pid). Rust is unscoped: a handle like `box/1` is a string that looks like an address, so handles may need a distinct representation.
2. **Call-site inference that sees every caller and refuses what it can't resolve:** the note's direction, done fully. Mixed callers (two classes, or a handle and an address) and functions passed as values are compile errors.
3. **Require an annotation:** remove inference; a local actor needs `(b @Box)`, and an untyped param receiving one is a compile error. Small and predictable, but JS would refuse something it can do.

If option 1 is too expensive on Rust, take 2 or 3: either fails at compile time rather than silently.

## 2. Decide: a type variable in cross-file signatures

A caller across a file boundary sees only the signature, so it can't infer a relationship between input and output types. Today these lose their types to `Anything`, checked at run time through `ty` and `as`:

- containers of open-ended element types: `first (xs List of T) -> (T)`;
- functions passed as arguments: `apply (f, x)`, `retry (f)`;
- boundary types: `sign (x T) -> (Signed of T)`, `verify (s Signed of T) -> (T)`, where losing `T` statically is exactly where trust is enforced.

The note finds a small explicit type variable in docs would remove more `Anything` handling than it adds. Decide whether boundary types are worth checking statically, and if so the spelling and its Opre encoding (notes/opre-tagged-forms-2026-11-24.md).

## Done when

- A function's param handling doesn't depend on which other callers exist, or the compiler refuses the cases it can't resolve.
- Tests on JS, Rust and Erlang cover:
  - an in-process actor passed to an untyped param, directly and from a local;
  - an actor from a cell or a typed local;
  - callers passing different classes;
  - one caller passing an in-process actor and another passing an address;
  - a call from a constructor block;
  - a function passed as a value.
- If inference is removed, `inferActorParams` is gone and the existing tests in public_class.test.js still pass, or are annotated under option 3.
- The type-variable question is decided in a note, and split into its own ticket if the answer is yes.
