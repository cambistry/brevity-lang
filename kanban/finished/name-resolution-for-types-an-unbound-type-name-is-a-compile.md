---
created: 2026-11-19
---
# Name resolution for types — an unbound type name is a compile error

Problem

Type-position names are never resolved either:

```
x Thnig = 1            compiles
echo = (c Class) -> c  compiles
Integer!               accepted as a type name
```

Types are carried as strings and nothing checks them against what is declared. (Companion to the value-position name-resolution ticket.)

Scope

Resolve every type name in type position — annotations, params, returns, cell types, `of` arguments, union members, `::` paths, constructor profiles, interface documents — against:

- builtin types (src/ast.js BUILTIN_TYPE_NAMES) and their plural forms after `of`
- `type` declarations in scope, including types reached through an actor (`Svc::Point`)
- actors/classes in scope (an actor-built type, `x C = C()`)
- `class` (the running actor's class)
- types a `use`d dependency's document declares
Anything else: `'Thnig' is not a type`.

Notes

- Types arrive as strings from many places (parser, parseInterface, inference). Resolve on the parsed structure where possible; src/parser.js parseTypeText already parses a type string with the real grammar.
- The rule "a type name in scope is reserved: no param may share it" (resolveLoneNames) depends on the same scope — share it.

Acceptance

- The three examples above fail with `'<name>' is not a type`.
- A test per binding kind resolves.
- js, rust, erlang suites pass.
