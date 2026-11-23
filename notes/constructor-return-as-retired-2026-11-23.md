# Constructor return-as is retired — 2026-11-23

Decided in discussion. Supersedes `self-becomes-2026-04-14.md` (tail return as structural
interface extension) and what remained of `implicit-return-is-projection-2026-04-10.md`.
`self as` (`__tests__/keywords/self_as.md`) is the one way an actor projects as a value.

## What return-as was for

```brevity
TextDiv = (initial) *{
  text *Text = initial
  return <div>{ text }</div>
}
tdiv = TextDiv("first")
element = tdiv as HTML::Element
tdiv.text <- "second"
```

The constructor's tail `return expr` gave the actor an implicit `as` clause for `expr`'s
type. The actor is a wrapper that hosts `text` for the `<div>` to subscribe to, and can be
talked to on its own.

## Why it goes

- **`self as` already says it**, and says it where it's read:

  ```brevity
  TextDiv = (initial) *{
    text *Text = initial
    self as HTML::div = -> <div>{ text }</div>
  }
  ```

- **`return` in a constructor reads as "the constructor yields this"**, but the caller still
  gets the actor. One form had two answers to "what did I get?".
- **The usual case doesn't want a wrapper.** Where the element itself should be the
  receiver, the natural form is a function that returns it, with the state in cells that the
  element's closures hold (`escaping-frames-2026-11-23.md`). Where the element should carry
  published names of its own, that's element extension (future direction, below), not a
  wrapper projecting as an element.
- "Becomes" needed the receiving function's signature to unwrap the wrapper's address at the
  call site. `self as` is an ordinary coercion: it renders or fails
  (`session-2026-11-01-as-renders-or-fails.md`).

## The rule

A constructor block's result is its actor.

- `return self` / tail `self` stays: it ends the body, and replies like `new`
  (`session-2026-11-03-self-return-like-new.md`).
- `return expr` with any other `expr` in a constructor block is an error. So is the `->`
  tail form of it.
- `return ()` / `-> ()` stays a no-op.
- A projection is a `self as` clause. There's no implicit one.

## Consequences

- The declaration return (`declarationReturn` in the AST, the parent's value for superclass
  ingest) has no source form left. It goes, with whatever reads it on each target.
- Tests and notes that write `return <element>` (or `-> <element>`) at a constructor's tail
  move to `self as`, or to a function returning the element, by what they mean.

## Future direction: element extension

```brevity
Receiver = -> <div
  version *Integer = 1
  @bump = { version <- version + 1 }
>{ version }</div>
rx = Receiver()
rx.bump
```

A tag head that declares names reads as `HTML::div ^ *{ … }`: a subclass whose base is the
DOM node. This is the form for "the element is the receiver and has names of its own". Not
designed yet: whether the extension runs in the HTML host (so `rx` is the DOM node's
address, with no wrapper), what makes the form callable, and how the tag head mixes
attributes with declarations. It builds on `remote-superclass-2026-11-16.md` and
`actorization-bundling-2026-05-15.md`.
