---
status: inbox
created: 2026-05-13
---
# `unhandled`: a clause declines with `return unhandled`

`unhandled` is the reply when nothing answers a message. Per notes/clause-lists-2026-11-25.md, clauses are tried in order and no match is `unhandled`.

A guard in a function body hands the message to the next clause; when the last clause declines, the caller gets `unhandled`.

- Only before any effect (a write, a send, a `!` call): a compile error after one. A transaction that rolls back could lift this later (see the transactions tickets).
- Applies to overload clauses and clause lists alike.
- Not implemented: no lexer, parser or test support.

Decide the name: something from pattern-matching vocabulary, if it reads better as a return than `unhandled` (`pass`, `decline`, `no match`…). The wire reply may keep its own name.

Related: `misapplication-of-the-unhandled-exception-to-addressing` (whether a missing actor gets the same reply as a missing method).
