# Types Implementation Plan — 2026-04-27

Consolidates the design decisions for Brevity Types after the 2026-04-27 design
conversation. Builds directly on `type-class-split-2026-04-25.md` (which decided
the Class/Type vocabulary split, introduced `::`, and established the wire-side
positioning of types as portable data shapes).

Status: **specified**, not yet implemented. No tests yet.

---

## Declaration

`::Name = (fields)` is the canonical declaration. The same form appears in
several layouts:

- **Inline:** `::Point = (x Integer, y Integer)`
- **Multiline delimited:**
  ```brevity
  ::Company = (
    name: Text,
    address: Text,
    ranking: Integer
  )
  ```
- **Lineal** (double-LF or `.` terminated):
  ```brevity
  ::Point =
    x Integer
    y Integer
  ```
- **File form** (`Point.bv` as a type file — filename is the name):
  ```brevity
  ::
    x Integer
    y Integer
  ```
- **Hidden** (rare, suppresses external visibility): `::#Name = (...)`

`::` appears at declaration sites (`::Name`) and cross-module references
(`Service::Name`). **Field type annotations within a type use bare names**, not
`::`:

```brevity
::User = (? profile: Profile)            // correct
::User = (? profile: ::Profile)          // wrong
::User = (? profile: Service::Profile)   // correct — cross-module ref
```

The `::` operator cannot appear in runtime code. The type/program register
separation is syntactically enforced.

---

## Field syntax

A field declaration is `[? ]name[: type | type]`. The four variants:

| Form | Meaning |
|---|---|
| `name Type` | positional, required |
| `name: Type` | named, required |
| `? name Type` | positional, optional |
| `? name: Type` | named, optional |

Positional and named fields may be mixed within the same type:

```brevity
::Rank = (score Integer, kind: Text)
```

Nested anonymous types do not re-signal `::` — once inside `()`, further `()`
are read as type shapes:

```brevity
::Company = (
  name: Text,
  address: (
    street: Text,
    zip: Text
  )
)
```

### No defaults

Types describe shape only. Default values are construction-time policy — they
embed program logic in something that should be inert, and they create
ambiguity across services that may not agree on what a default means. The role
of "convenience at construction" is filled by **optionality plus `??`
fallback**, which keeps the policy at the call site instead of the declaration.

### Field names are part of the interface

Unlike constructor parameters, where names may be local-only, field names of a
type are part of the published contract. Implications:

- Renaming a field is a breaking interface change.
- Adding a trailing optional field is backward-compatible.
- Reordering required fields is breaking.

The wire payload itself does not carry names (see Wire format below) — names
are recoverable from the canonical declaration via the type tag.

---

## Optionality

A field-level prefix `?` marks the field optional:

```brevity
::Game = (
  ? started Boolean,
  ? turn: Integer,
  ? players: List of Texts
)
```

Two consumer-side operators interact with optionality:

### Presence check — `(expr)?`

Required parens. Returns `Boolean`. The parens prevent collision with
`?`-suffixed predicate field naming (`started?` remains valid as a field name):

```brevity
if (game.started)? { ... }
```

### Fallback — `expr ?? alt`

No parens required. Returns the field's type when present, `alt` when absent:

```brevity
turn = game.turn ?? 0
name = user.nickname ?? "anon"
```

### Chained access semantics

- **Bare access errors at the first absent hop.** `user.profile.avatar` raises
  when `profile` is absent. Unguarded access stays honest.
- **`(...)?` and `... ?? fallback` short-circuit the entire chain.** Any
  absence anywhere in the chain produces `false` (or the fallback). Tolerance
  composes the whole way down.

```brevity
has_avatar = (user.profile.avatar)?           // false if any hop absent
avatar     = user.profile.avatar ?? "none"    // "none" if any hop absent
user.profile.avatar                           // errors if profile absent
```

---

## Construction

`Name(args)` produces an immutable Structure tagged with the type.
`Name!(args)` produces an actorized cell that can receive messages and be
reassigned via `<-`.

- **Positional construction** is valid only when no skipped fields, or only
  trailing optionals are skipped: `Point(1, 2)`, `Game()`.
- **Named construction** is the general form: `Point(x: 1, y: 2)`,
  `Game(turn: 3)`.
- Mixed positional+named at the call site follows existing argument-passing
  rules.

### Coercion by context

The bare-tuple form coerces into a typed value at any typed assignment or
argument site. The following are equivalent:

```brevity
@coords Point! = (0, 0)
@coords Point! = 0, 0
@coords = Point!(0, 0)
```

What is happening on the right side is a Structure being created and coerced
into the Type by the LHS or argument-position context.

### Equality is strict

Without context, structural equality does **not** auto-coerce:

```brevity
Point(0, 0) == (0, 0)       // false — Point is tagged, the tuple is not
Point(0, 0) == Pair(0, 0)   // false — different type tags
Point(0, 0) == Point(0, 0)  // true
```

---

## Destructuring

Types destructure with **permissive selection** and **strict existence**: any
subset of fields may be pulled, but referencing a field the type does not
declare is an error. Destructuring on types is more permissive than
destructuring elsewhere in Brevity — you don't need to take all fields.

### Positional destructure — head values only

Pulls field values by position. The destructure may take the first N fields,
where N is at most the field count. Local names are arbitrary and need not
match field names.

```brevity
p = Point(1, 2)

(x, y) = p          // x = 1, y = 2
x, y = p            // same — parens optional
(x) = p             // x = 1; second field discarded
(a, b) = p          // a = 1, b = 2 — locals named freely
```

Asking for more values than the type has is an error:

```brevity
x, y, z = p         // error — Point has 2 fields
```

Positional destructure cannot skip middle fields. Use named destructure for
selective extraction.

### Named destructure — selective

Pulls fields by name. Order-insensitive. The `:field` form is shorthand for
`field: field`, consistent with the named-param sigil convention at call
sites.

```brevity
:x, :y = p          // x = 1, y = 2
:x = p              // x = 1 — selective; only x extracted
x: alias_x = p      // alias_x = 1 — rename on extraction
:y, :x = p          // y = 2, x = 1 — order-insensitive
```

Referencing a field the type does not declare is an error:

```brevity
:z = p              // error — Point has no field z
```

### Positional fields destructure by name

Field names are part of the interface contract regardless of how the field
was declared (positional `x Integer` vs named `x: Integer`). Named
destructure works in either case:

```brevity
::Point = (x Integer, y Integer)
:x, :y = Point(1, 2)                  // valid
```

A producer can switch a field between positional and named declaration
without breaking named-destructure consumers. Field name identity is what
matters at the destructure boundary.

---

## Mutation

For now, `Type!` cells support **whole-cell replacement only**:

```brevity
@coords <- (@coords.x + x, @coords.y + y)
```

The RHS is a Structure that coerces back into a Point because the LHS is a
`Point!` cell.

Per-field write (`@coords.x <- v`) is **deferred**.

---

## Field access

- **Internal access** (within the owning actor): `@cell.field` is local
  projection on the current cell value. No CAM round-trip.
- **External access** (from another actor): `Owner.cell` is a CAM call
  returning the typed value; `.field` projects locally on the returned
  Structure.

`Location.coords.x` is therefore one CAM hop, not two: `Location.coords` comes
back as a Point (annotated via `bv-a`), and `.x` is a local index on the
returned value.

---

## Wire format

### Type tag

Types reuse the existing `#<alias selector>` address machinery:

```
#<geometry.bv ::Point>
```

The selector form `::Name` makes the type/program register visually distinct
on the wire as well as in source.

### Payload shape

The shape of the payload depends on whether the type contains optional fields:

- **All-required types** serialize positionally: `[0, 0]`.
- **Types with any optional fields** serialize as a name-keyed map:
  `{turn: 3}`. Absent fields are omitted.

This mirrors the existing Structure conventions: positional arg lists carry
positional payloads, named arg lists carry named payloads.

### Annotations — `bv-a`

The annotation channel runs parallel to the payload. It carries type tags (or
scalar tags) per slot. It does **not** carry field names — names are
recoverable from the type's canonical declaration.

### Worked example

`Location` is a class with `coords Point!` state and a `shift` handler:

```
{op: "coords"}
{re: [[0, 0]], bv-a: ['#<geometry.bv ::Point>']}
{op: [[1, 2], "shift"], bv-a: [[Integer, Integer]]}
{op: "coords"}
{re: [[1, 2]], bv-a: ['#<geometry.bv ::Point>']}
```

Note: the `shift` arg annotation reflects the declared signature
`(x Integer, y Integer)`, not a coincidental Point shape. Annotations come from
the call site's static contract, not from payload pattern-matching.

---

## Interface representation

Types appear in interface documents in the same form as their declaration,
including the `=`:

```
{
  ::Point = (x Integer, y Integer)
  ::Game = (
    ? started Boolean,
    ? turn: Integer,
    ? players: List of Texts
  )
}
```

Definition form and interface form are syntactically identical modulo the
enclosing braces. Field names are retained because they are part of the
contract.

---

## Imports

Type imports use the standard destructure grammar — orthogonal to the
type/class distinction. The leading colon in `(:Point)` is the existing
destructure marker, not a kind discriminator:

```brevity
<"geometry.bv": (:Point)>            // import type Point
<"location.bv": Location>            // import class Location
<"geometry.bv": (Point: P)>          // alias — local name P, wire still ::Point
```

Aliases are source-local. The wire tag always points to the canonical
declaration site (`#<geometry.bv ::Point>`) regardless of the importer's local
name.

---

## Class / Type boundary, restated

| | Class | Type |
|---|---|---|
| Declared with | `Name = <params> { body }` | `::Name = (fields)` |
| Cross-module ref | `Service.Name(args)` | `Service::Name` |
| Has actor lifecycle | yes | no |
| Has address | yes | authority address only |
| Instantiation | `Name(args)` → hosted actor | `Name(args)` → immutable value |
| Actorized form | already an actor | `Name!(args)` |
| Travels on wire | by address | by value (as BV Structure) |
| Can have methods | yes | no |
| Can have defaults on params | yes | **no** — types have no defaults |
| Can have optional fields | n/a (params) | yes (`? name Type`) |

---

## Deferred / open

- **Per-field mutation on `Type!` cells.** Whole-cell only for now.
- **Type overload semantics.** `::Point << (:x Integer, :y Integer)` — whether
  overloads must produce the same external interface, or constitute a union
  (cartesian + polar Point). BV Structure content-based dispatch handles
  either reading; canonical choice not yet made.
- **Public/protected/private on type fields.** Types are fully open by
  default. The `::#Name` hidden form exists for the type itself; per-field
  visibility has not been considered and may not be needed.
- **Destructure of optional fields when absent.** Strict existence governs
  declaration: `:z = p` errors because `z` is not a declared field. The
  runtime case — `:turn = game` when `turn` is a declared optional field
  that happens to be absent on this value — is not yet specified. The
  consistent reading with the chained-access rule is "bare destructure
  errors at runtime on absent optionals; tolerant destructure (TBD syntax)
  short-circuits."

---

## Implementation slicing

Outside-in, smallest viable end-to-end first. Earlier slices yield usable
shape support; later slices layer ergonomics and the wire/interface story.

1. **Parser: inline `::Name = (fields)`**, positional fields only, single-line.
2. **Type registry.** Canonical declaration sites; module-qualified identity;
   `#<file ::Name>` resolution.
3. **Construction.** Positional `Name(args)` → tagged Structure.
4. **Equality.** Tag-aware comparison; strict cross-tag inequality.
5. **Local field access.** `value.field` projection on a typed Structure.
6. **Cross-module references.** `Service::Point` at use sites.
7. **Multi-line and lineal declaration forms.** Including the file-level
   `::` form.
8. **Named field syntax** (`name: Type`) and **mixed positional/named** within
   the same type.
9. **Tuple→Type coercion** at typed assignment / typed-argument sites.
10. **`!` actorization for types.** `Name!` cells, whole-cell mutation via
    `<-`.
11. **Optionality.** `?` field qualifier; `(expr)?` predicate operator;
    `expr ?? alt` fallback operator; chain short-circuit semantics inside
    tolerant operators; chain-error semantics for bare access.
12. **Wire serialization.** Positional payload for all-required types; map
    payload for types with any optional fields. Per-target codegen
    (JS / Rust / Erlang).
13. **`bv-a` annotation channel** emission for typed payloads and typed args.
14. **Interface document emission** with the `=` form.
15. **Import binding plumbing** for type imports — reuses destructure grammar
    alongside the existing class import path.

Slices 1–6 unlock required-only shapes for local use. Slices 7–11 layer the
ergonomics and dynamic features. Slices 12–15 close the wire and interface
story.
