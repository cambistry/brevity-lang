# Suggestion: binderless Type declarations (`::Name (…)`, no `=`) — 2026-10-25

Status: **suggestion / proposal.** Not implemented. Current syntax is
`::Name = (fields)`; this proposes dropping the `=`.

## Proposal

Declare a Type by juxtaposition — leading `::`, name, definition — with no
binder operator:

```
::Point (x Integer, y Integer)   // record type
::Num Integer                     // alias
::Names List of Text              // alias to a type expression
::P Geom::Point                   // alias to a qualified reference
::Token                           // opaque / nominal, no body
```

One shape, `::Name <definition>`, where `<definition>` is a parenthesized
record, a bare type expression, or nothing. No `=`, no `::=`, no `:=`.

## Motivation

`=` in Brevity is the **create/bind** operator (`=` create, `<<`/`>>`
append/prepend, `<-` set). Every other `Name = …` form binds a name to a
thing that comes into runtime existence: a cell (`x = 5`), a callable
(`f = |x| …`), a constructor with an address (`C = *(…) {…}`).

A Type creates nothing. Per `type-class-split-2026-04-25.md` it is "homeless,
no address, no lifecycle" and "doesn't happen" — it defines a convention at
the protocol level. Using the runtime-binding operator for a construct with
zero runtime footprint is a category mismatch. Dropping `=` makes the
distinction exact and exceptionless:

> **`=` always and only means a name binds to a runtime entity. Types never
> use it.**

The syntax then encodes the ontology instead of hiding it, and the forms
rhyme: a class is `Name = *(…) {…}` (runtime-binding `=`, actorizing `*`); a
type is `::Name (…)` (neither).

## Why this is unambiguous

`name Type` field syntax exists **only inside `( )`** — there is no parenless
field list anywhere in the grammar. So `::Num Integer` cannot be misread as a
field; `Num` is the type name, `Integer` the definition. Parser rule is
single-token lookahead after the name:

```
::Name '('  → record
::Name else → alias (type expression)
::Name <eol> → opaque
```

Leading `::` can never begin a construction (`Point(…)` has no prefix), so
declaration vs construction is clean. Infix `::` (qualified ref `Geom::Point`)
is untouched — this is prefix `::`, at statement start.

Statement termination (not ambiguity) is the only edge: `::Token`\n`Integer`
must read as an opaque type then a separate `Integer` statement, governed by
the existing lineal-form rules, not as a line-split alias.

## Why not the alternatives

- **Keep `=`** (`::Point = (…)`): reuses the runtime-binding operator for a
  non-runtime construct; the mismatch the proposal removes.
- **`::=`** (BNF "is defined as"): best external pedigree, and semantically
  honest, but starts the statement with a bare identifier → loses the
  zero-lookahead declaration marker the leading `::` gives.
- **`:=`**: imports Pascal/Go *assignment* (runtime store) connotation — the
  exact flavor being rejected — and leans type decls on the single-colon
  annotation family (`name: Type`, `(:field)`) rather than the double-colon
  type register. Both `:=` and `::=` are lexically free in Brevity source
  (`:=` appears only in Erlang codegen output), so this is a semantics call,
  not a collision one.

Juxtaposition wins because it keeps the leading `::` (zero-lookahead,
type-register-consistent) **and** drops the binder.

## Prior art

- **Structural decl without a binder**: Rust `struct`/`enum`, Go
  `type T struct {…}`, TS `interface`, C `struct` — mainstream. `::Point (…)`
  sits here comfortably.
- **Alias without a binder**: the outlier case. Most languages use `=`
  (Haskell/TS `type`, Swift `typealias`, Rust `using`). The one strong
  precedent is **Go**: `type Num int`.
- **`::` glyph**: infix `::` = Rust/Scala path separator (matches our
  qualified ref exactly). Leading `::` as "a type begins" is novel, and mildly
  cross-talks with FP's `::`/`:` = "has type" (annotation) register.

## Open question — nominal vs transparent alias

Go's `type Num int` (the syntax we'd echo) makes a **distinct nominal** type:
`Num` and `int` are not interchangeable. `type Num = int` is the transparent
alias. So the borrowed syntax means "new nominal type" in its home language.

Decide what `::Num Integer` means. Leaning **nominal** — it matches the prior
art the syntax evokes, and nominal typing suits a wire-schema / trust language
(a `UserId` that can't be silently crossed with a bare `Integer`). If a
transparent alias is also wanted, it needs its own distinct spelling.

## Current compiler state (for contrast)

- Type RHS is always a parenthesized record; `=` is mandatory and always
  followed by `(`. Confirmed by direct `compile` runs.
- Non-paren RHSs are rejected today: `::MyInt = Integer`,
  `::Names = List of Text`, `::P = Geom::Point` all fail ("Expected type
  name"). So aliases don't exist yet — this proposal would introduce them
  alongside the binderless form.

Related: [[type-named-construction-gap-2026-10-25]],
`type-class-split-2026-04-25.md`, `vocabulary-refactor-2026-05-15.md`.
