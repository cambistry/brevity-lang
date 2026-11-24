---
name: Overload model
description: Functions and constructors use = create, << append, >> prepend for overload dispatch. Function() is the empty initializer. Constructor() was removed.
type: project
---

Every function/constructor binding is an Overload — an ordered list of clauses.

- `=` creates (single clause)
- `<<` appends clause (tail — tried last)
- `>>` prepends clause (head — tried first)
- `Function()` creates an empty overload (zero clauses)
- `Constructor()` was removed — Function() is universal

**Why:** duplicate `=` on the same name was silently creating overloads (accidental feature). Now duplicate `=` is a redefinition error; explicit `<<`/`>>` required.

**How to apply:** codegen generates arity+type dispatch for overloaded names. Lambda overloads share dispatch labels with arity conditions. Constructor overloads generate synthetic actor classes with mangled names. Compile-time type inference (literal→type) handles same-arity type discrimination.

Implemented 2026-04-06. Stashed optional-args work depends on this.
