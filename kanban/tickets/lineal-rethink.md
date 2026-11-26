---
status: inbox
created: 2026-11-14
---
# Lineal definitions: parenthesised params, `end#name` closer, implicit tail return

Concept, not decided: notes/lineal-definitions-2026-11-25.md.

- Params on one line or one per line inside `(…)`; a constructor's lead `*(…)`. Replaces the `*` … `*` lineal constructor header.
- A lineal body runs to `end#name`, which must equal the binding name; no bare closer; labels nest.
- A function's body is lineal exactly when a matching `end#name` follows in the same scope; otherwise `f = (a, b)` is an Object.

Implicit tail return: with `end#name` closing the body, its last expression is the value, as in a braced body (lineal bodies have none today: notes/lineal-termination-implicit-return-2026-10-26.md). A multi-value tail is an Object: `x, y` positional, `x: 123, y: 456` named.

Open (from the note): a blank line after `)`; return types on a lineal body; whether the file header follows the same shape; lineal singletons.

Done when decided in a note, then built on js, rust and erlang with lineal_form tests, and the `-> result: …` tails in those tests become bare tails.
