---
status: inbox
created: 2026-11-19
---
# Private cells and constants outside function bodies: join the scope tests

`#t Integer = 3` and `#t *Integer = 0` parse in a function body. In a file actor or class body they don't ("Expected '=' after private function '#t'"); that's the private-values work (find its ticket/notes: notes/ private-names-lexical-2026-11-16.md and any private-values note).

Investigate

- State of private values at actor level: what's designed, what's implemented, what blocks it.
- Once they parse: their wire labels (`#t`), reads from inner scopes (outer reads), writes to a `#t *` cell, subscribe to it (see the enclosing-cell subscribe ticket), and that `x.#t` stays an error.

Done when private cells and constants declared in a file actor, a class and a class block are rows in __tests__/classes/lexical_scope.test.js — read, write (cells), subscribe — passing on js, rust and erlang. Until then, this ticket only tracks the dependency.
