# Element extension: names on the element — 2026-11-23

**Proposal**, from discussion. `@name={ … }` in a tag head is liked; the `^{ … }` code block
is tentative. Fills in the future direction in `constructor-return-as-retired-2026-11-23.md`.
Redefines the tag-head declarations of `session-2026-04-27.md` (reactive singleton
elements), and the "Singleton Elements" sketch in `bvx-conclusions.md`.

## The idea

A tag head that declares names extends the element. `<div …>` with names of its own is
`HTML::div ^ { … }`: a layer on top of the DOM node, made once each time the expression is
evaluated (a singleton layer, as in `caret-composition-2026-11-19.md`). The element itself is
the receiver. There's no wrapper actor, and nothing to unwrap when the element is passed
where an element is expected.

```brevity
Receiver = -> <div
  ^{ version *Integer = 1 }
  @bump={ version <- version + 1 }
>{ version }</div>

rx = Receiver()
rx.bump
body.append!(rx)          // rx is the div's address
```

`Receiver` is an ordinary function returning a fresh element. Being callable needs no rule of
its own.

## `@name={ … }`: a published function

An attribute whose name carries `@` publishes a function on the element. It's a minimal layer
over HTML's attribute syntax: `onclick={ … }` is an HTML attribute with a Brevity value,
`@bump={ … }` is a name on the element.

- The value is a function: `@bump={ … }`, `@set=(v Integer) -> { … }`.
- `@name="text"`, or any value that isn't a function, isn't defined. Open whether it should
  mean a published cell; it has no place for a type or `*`.
- An `@` attribute never reaches the DOM as an attribute.
- Vue uses `@click` for event listeners. Here `@click={ … }` would publish a function named
  `click`, not listen for clicks. Events stay `onclick={ … }`.

## `^{ … }`: declarations (tentative)

Bare declarations in a tag head (`count *Integer = 0`, as the 2026-04-27 form allows)
read badly among attributes. A code block holds them instead:

```brevity
<div ^{ count *Integer = 0; @reset = { count <- 0 } } onclick={ count <- count + 1 }>
  { count }
</div>
```

- `^{ … }` is the layer's body, spelled as the layer it is: `HTML::div ^ { … }`.
- Any declaration goes there: private cells, published cells (`@color *Text = "black"`),
  functions. `@name={ … }` in the head is shorthand for `@name = { … }` inside it.
- Names declared in it are lexically visible to the head's attribute values, to its `@`
  attributes, and to the children.
- At most one `^{ … }` per head (open: whether several should merge).
- Bare declarations in a tag head are no longer a form.

What the block runs in is open ("a transient actor context, maybe"):

- **The element's layer.** The block is the layer's body, so `count` is the element's
  private cell and lives with the element. `self` is the element.
- **A transient context of the enclosing code.** The block runs where the expression is
  evaluated, and its names are a frame there (`escaping-frames-2026-11-23.md`) that the
  element's closures hold.

The first fits the reading `HTML::div ^ { … }` and gives the state a home that goes away
with the element. The second needs no code in the HTML host.

## Where the layer runs

- **In the HTML host (preferred).** The layer's functions and cells run beside the DOM node,
  so `rx` *is* the node's address (`HTML @div/N`), and the rep answers `bump` as well as its
  own ops. On the browser target the host is a subsystem in the same process, so this is a
  rep with extra handlers. Where the HTML host is remote from the declaring code, the layer's
  code ships to it: the bundling consequence of `actorization-bundling-2026-05-15.md`.
- **By delegation (not preferred).** The layer is an actor beside the declaring code with the
  DOM node as its base (`remote-superclass-2026-11-16.md`). `rx` is then the layer's address,
  and `body.append!(rx)` hands DOM an address it doesn't own. That's the unwrap problem that
  retired "self becomes".

## Relation to the other notes

- **Escaping frames.** Element extension is a second home for state that outlives its call:
  `-> <div ^{ count *Integer = 0 } onclick={ … }>{ count }</div>` puts `count` in the element,
  where the plain function form puts it in a frame of the declaring actor. If the layer runs
  in the HTML host, the element's lifetime is the state's, and no release rule is needed for
  it.
- **Subscribability.** A function returning an extended element has a fresh actor in its
  result, so it falls under (a)/(b) in `subscribability-2026-11-23.md` like any element.

## What changes from 2026-04-27

The existing pass (`liftReactiveElements`, `src/extract_passes.js`) does the opposite of this
note. It lifts tag-head declarations **into the enclosing actor**: `<div @color *Text =
"black" style={ … }>` gives the enclosing actor a public `@color`, and the element gets no
names. A parameterless function without a sigil (`style={ … }`) becomes a reactive attribute.

Under this note:

- `@color` declared for an element is the element's (`el.color <- "red"`), not the enclosing
  actor's. Tests that set it on the parent (`__tests__/html/reactive_element.dom.test.js`,
  Q3) move to the element.
- `style={ … }` stays a reactive attribute: an HTML attribute with a Brevity value, not a
  declaration.
- Lifting goes.
- The pass merges the head's functions into the enclosing actor only when the head also
  declares a ref cell, so a head with only `@go = { … }` appears to lose `@go` without an
  error (from reading the code, not run). Whatever replaces the pass mustn't drop anything.

## Open

- What `^{ … }` runs in (above).
- Published cells in attribute form (`@count=0`?), or only inside `^{ … }`.
- Whether `^{ … }` can declare `#` names, and what `base` is in the layer (the DOM node).
- Several `^{ … }` blocks in one head.
- The lexer: today it captures a head as a raw `bvBlock` when the first attribute starts with
  `@` or any character outside `[a-zA-Z0-9_-:]`. A head mixing ordinary attributes, `@`
  attributes and `^{ … }` in any order needs to be tokenized, not captured.
