---
status: done
created: 2026-10-30
---
# Parser decides type vs. name by capitalization

The parser uses an uppercase check (/^[A-Z]/) to decide whether an identifier is a type. Capitalization is only a convention, so the grammar shouldn't depend on it.

The clearest case is the destructure statement (src/parser.js ~2496 and ~2677, whose comment says "uppercase = type, not local name"):

```
value: v = f(7)          → key value, local v
value: Integer = f(7)    → named value, type Integer
```

The same check appears in about 25 places in src/parser.js and 6 more in validate and codegen. Examples:

- peekIsType, ~892: Name = default counts as a type only if uppercase
- typed positional destructure, ~2518
- header destructure member types, ~5049
- &Name refs
- constructor-call detection, ~3586 and ~4786

**Replacement** **rule** (decided 2026-10-29): a type name in scope is a locally reserved word, so no param, local or binding may share its name. A lone name is a type if one by that name is in scope, and otherwise a local.

- Scope is built-ins, the file's :: declarations and classes, and every name the header binds.
- Types can be declared later in the file than where they're used, so the check has to run after parsing.

Param lists and header dependencies are being converted in the params-document / header-notation work. This ticket covers the remaining sites.
