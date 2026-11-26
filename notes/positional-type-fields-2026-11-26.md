# Positional type fields have no names — 2026-11-26

Supersedes, for a declared type's fields: the "positional fields keep their names" rule
(`%names`) in `opre-type-encoding-2026-11-21.md`, the named-filling of positional fields in
`type-named-construction-2026-10-26.md`, and the field-access and wire sections of
`types-implementation-plan-2026-04-27.md` where they assume named positional fields.

## Decision

A declared type is an Object with constraints. Its fields are entries as an Object's are:
positional ones are read by position, named ones by name.

- **A positional field is a bare type:** `type Point (Integer, Integer)`. A named field is
  `name: Type`. `? ` marks either optional: `type Game (? Boolean, ? turn: Integer)`.
  A name followed by a type with no colon (`x Integer`) is an ordinary parse error.
- **Positional fields come first,** then named, as in `ty` and an Object.
- **A positional field is read by positional destructuring only:** `(x, y) = p`. There is
  no `p.x`, and named destructure (`:x = p`) and named filling (`Point(x: 1)`) don't reach it.
- **A named field is filled by name only:** `Pair(x: 1, y: 2)`. `Pair(1, 2)` is an error. It is
  read by name (`p.x`, `:x = p`); a positional destructure takes positional fields only.
- **The encoding has no `%names`:** `type Point (Integer, y: Integer)` is
  `":Point": ["Integer", { "y": "Integer" }]`.
- **The wire form is a list:** the positional values given, then the named values given in
  one trailing object. Positional values are always a prefix, since positional args fill in
  order, so no slot is ever padded. It is a list even with no positional values, as a bare
  object in an arg list is the named-args bag. A type with named fields reads a trailing
  plain object as them.
  `Point(1, 2)` is `[1, 2]`; `Pair(x: 1, y: 2)` is `[{ "x": 1, "y": 2 }]`;
  `Mixed(3, label: "hi")` is `[3, { "label": "hi" }]`;
  `Game (? Boolean, ? turn: Integer)` as `Game(turn: 5)` is `[{ "turn": 5 }]`, and
  `Game()` is `[]`.

## Open

- A positional field holding a plain Object, last in the list of a type with named fields,
  reads as the named values. Typed values are lists, so only an `Object`-typed positional
  field can meet this.

## Reasons

- If a type is positional, that should be the nature of the thing modelled, not a way to
  skip naming. A name that is part of the interface belongs on a named field.
- One shape for entries everywhere: params, replies, Objects and types read the same way.

## Implementation

- A positional field's runtime key is its index among the positional fields (`"0"`, `"1"`),
  which no Brevity name can spell.
- A positional function-typed field has no name, so the `!` / `.` naming discipline applies
  to named function fields only.
