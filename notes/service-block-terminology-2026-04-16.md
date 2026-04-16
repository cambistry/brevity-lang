# The constructor's trailing block is the service block (2026-04-16)

Terminology decision. The code that follows a constructor's header — previously called "init block," "declaration block," "declarations," or "constructor body" — should be called the **service block**.

Status: **decision**, grounded in existing grammar. Project-wide rename candidate. Existing files flagged below.

## The insight

An interface document already has the answer. A constructor's published shape is:

```
<constructor header> -> { service interface }
```

The header produces a service. The trailing block is what *defines* that service — its handlers, its state, its lifecycle behavior. The grammar is unambiguous about the role of each part.

Applied to source:

```
<
  constructor header
>
=
service block
```

or in delimited form:

```
<constructor header> -> { service block }
```

The `-> {...}` punctuation is literally the declaration "header produces service." The trailing block is the service being produced.

## Why the old names were wrong

- **"Init block" / "initialization"** — misleading. The angle brackets themselves are where initialization happens: param capture, dependency binding, argument processing. By the time execution reaches the trailing block, init is done.
- **"Declaration block" / "declarations"** — too generic. Everything in Brevity is declarative in some sense; calling one specific block *the* declaration block hides what makes it distinct.
- **"Constructor body"** — structurally accurate (it's inside the constructor construct) but non-semantic. Doesn't tell you what the block *is for*. Every construct with a scope has a "body."

"Service block" is semantic: it says what the block produces.

## Implications

- The constructor itself is "the thing that produces a service." The header configures; the block defines.
- Angle brackets alone can produce a static service — an immutable type with no handlers or state. Adding the trailing block is what makes the service *live* (stateful handlers, dynamic behavior).
- Published interface: `<header> -> { iface }` — same grammar as source. The interface is the service block's *shape* abstracted from its implementation.

## Update candidates

Found via repo search. These use older terminology for the same concept:

### Design notes (still active)
- `notes/implicit-return-refinements-2026-04-14.md` — "declaration block," "declarations block" (multiple instances)
- `notes/self-becomes-2026-04-14.md` — "declarations block"
- `notes/template-type-2026-04-10.md` — "declaration block," "declarations"
- `notes/implicit-return-is-projection-2026-04-10.md` — "constructor body" (note says superseded)

### Test-adjacent markdown
- `__tests__/keywords/ingest.md` — "declaration block," "initialization"
- `__tests__/constructors/ingest.md` — "declaration block," "declarations"
- `__tests__/constructors/accessors.md` — "constructor body"

### Test code comments
- `__tests__/keywords/ingest.test.js` — "constructor body," "declaration block"
- `__tests__/constructors/ingest.test.js` — "declaration block"
- `__tests__/constructors/wrapped.test.js` — "constructor body"

### Source code comments
- `src/codegen/javascript/classes.js` — "Collect service coercion aliases from constructor body"; "initialize state from params and constructor body"
- `src/codegen/rust/program.js` — "Collect service coercion aliases from constructor body"
- `src/parser.js` — "Constructor body: name *Type [= value]"; "Constructor body: name = *expr"

### Feature docs
- `kanban/2 - features/FUNCTION_ORDERING.md` — "constructor body"
- `kanban/2 - features/FORWARD_REFERENCES.md` — "constructor body"

### Internal identifiers (probably keep)
- `src/ast.js` — AST node fields `initBody`, `constructorBody` — internal variable names. Rename is nice-to-have but not user-facing. Defer unless refactoring that area anyway.

## Rename plan (not executed yet)

Not a mechanical global search-and-replace — some occurrences of "declarations" or "body" are innocent and shouldn't be touched. The rename should be done file-by-file, reading context to catch:

1. Phrases that clearly mean *the trailing block of a constructor* → "service block."
2. Phrases that mean *any code following any construct* → leave alone.
3. Internal AST field names (`initBody`, `constructorBody`) → lower-priority; rename during a parser/AST refactor rather than as a standalone pass.

Test-documentation markdown (`*.md` files in `__tests__/`) is probably the highest value to update first — those are read as living docs.

## Rule, stated

**The code following a constructor's `<...>` header, whether lineal (`=` + indented block) or delimited (`-> {...}`), is the service block. It is the implementation of the service the constructor produces.**
