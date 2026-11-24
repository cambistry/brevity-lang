---
status: done
created: 2026-11-13
---
# `type` keyword; types belong to actors; bare type names on the wire

Design: notes/type-keyword-and-actor-scoped-types-2026-11-13.md

## Summary

Replace the `::Name (fields)` declaration with the keyword form `type Name (fields)`. A type belongs to the actor (class) whose constructor block declares it, not to the file. A type is reached from outside through `::` on an actor or class, and its name is bare everywhere, internally and on the Opre wire.

## Declaration syntax

- `type Point (x Integer, y Integer)` — delimited form.
- `type Point` + indented fields, ended by a blank line — lineal form (otherwise unchanged).
- `::Point (…)` is unrecognized syntax: a plain parse error. The message must not refer to any earlier form.
- Service documents use the same syntax: `{ type Point (x Integer, y Integer) }`. Update `parseInterface` (src/codegen/javascript/types.js) and the emitter (index.js ~200-216).
- `type` is already in the lexer's KEYWORDS (src/lexer.js:1) but unused by the parser.

## Names

- A type's name is bare (`Point`) in the AST, runtime values (`__type`) and wire tags.
- Type names are public. No `#Type`, no protected types.
- `type Box` and a class `@Box` in the same scope: compile error.

## Placement

- A `type` declaration may appear anywhere in an actor's constructor block: file level (the file is an actor), a singleton (`**{ }`), or any class's constructor block (`*{ }`). Today parseTypeDecl only runs at file top level (src/parser.js ~5816).
- A type declared in a class's constructor block belongs to the class and is shared by all of its actors.
- Nesting is arbitrary: `A::B::X`.
- A type declaration may not depend on its containing actor: a field may not take a default from constructor params or read mutable state. (Type fields have no defaults today; keep it that way for nested types.)

## `::` access

- The left side of `::` is an actor or class: an injected service, a class, a singleton, or a constructed actor. `Svc::Point`, `Class::X`, `actor::X`, `Singleton::Widget`, `A::B::X`.
- Inside the declaring actor, the type is bare: `X(…)`.
- `A::X(…)` constructs the value locally from the field list in A's description; no message is sent. This also holds for imported services: `Svc::Point(1, 2)` works without destructuring `Point` from the header.
- The compiler must know A's class statically (constructed actor, injected service, typed local). Otherwise `A::X` is a compile error.
- `A::X` is valid only before `(…)` or in type position. Elsewhere (`t = Class::X`): compile error.
- Type position requires `::`: `p Class::X`. `p Class.X` is an error (parseAtomicType currently accepts `Name.Member`, src/parser.js ~484). `actor.X(123)` for a type: error.

## Wire tags

- A type tag is the authority's address followed by the bare name, with no `::`: `. Point`, `main Point`, `. Singleton Widget`, `. Class X`.
- The authority is the declaring class, never an instance (no `. Class 1 X`).
- A receiver recognises a type tag by looking up the name under its authority in the descriptions it knows (its own declarations plus imported service documents), not by tag shape. A tag it can't resolve passes through, as it does today.
- Sites that currently detect a type tag by the presence of `::`:
- JS: `_bv_from_wire`, `_bv_unwire_reply`, `_bv_unwire_packed` (src/codegen/javascript/runtime/wire.js); `_matchTypes` bareName/isTypeTag and `_bvTyOf` (src/codegen/javascript/preambles.js ~548, ~684); classes.js ~763.
- Rust: src/codegen/rust/program.js ~1103, types.js ~14/~356, handlers.js ~690/~777.
- Erlang: `bv_type_name`, `bv_bare_name`, the `__type` tag at preambles.js ~1271 (src/codegen/erlang/preambles.js).
- Translation and emitters listed in notes/session-2026-11-03-ty-without-brackets.md.
- Supersedes notes/session-2026-11-07-instance-type-authority.md: a type nested in a class is tagged with that class as its authority, not the file.

## Service documents

- A class's entry carries its types inside its interface block, recursively: `@Class (…) -> *{ type X (Integer) … }`.
- A non-public class's types are visible only within its file.

## Tests

- Migrate the ~156 `::Name` declarations across ~32 test files, and the ~19 hits in docs/, README.md and LANGUAGE_*.md.
- New coverage on all targets (js, rust, erlang):
- `type` in a class constructor block, a singleton, and nested two levels deep.
- Construction through `Class::X(…)`, `actor::X(…)`, `Svc::Point(…)`, and bare `X(…)` inside the declaring actor.
- Exact `ty` tags leaving the actor and at the caller (`. Class X`, `Svc Point`, `. Singleton Widget`), and decoding at the receiver.
- Service-document emission and parsing of nested `type` entries.
- Errors: `::Point (…)`; `type Box` with `@Box` in the same scope; `actor.X(…)`; `p Class.X`; `t = Class::X`; `a::X(…)` on an actor of unknown class; a type field that reads a constructor param.

## Out of scope

- `#Type` and protected types.
- Field defaults that vary by instance.
- Types as values (a type of types; `t = Class::X`).
- `self::X`.
- Types declared in function bodies.
- Whether compilation should proceed when linking fails.
