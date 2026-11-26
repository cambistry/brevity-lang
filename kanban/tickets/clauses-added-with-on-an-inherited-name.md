---
status: inbox
created: 2026-11-26
---
# Clauses added with `<<` / `>>` on an inherited name should work

A subclass adding clauses to a function it inherits, with `<<` or `>>`, doesn't work
(super-in-a-function-calls-the-base-s-same-function, gaps-in-super-implementation). In such a
clause, `super` dispatches over the parent's clauses only.
