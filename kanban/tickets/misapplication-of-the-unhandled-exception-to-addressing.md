---
status: inbox
created: 2026-11-21
---
# A missing actor and a missing method get the same reply

`unhandled` is the response to a message nothing answers, with the idea that actors can chain and handle overloads in sequence: an `unhandled` lets the caller fall through to the next handler (notes/clause-lists-2026-11-25.md: no matching clause is `unhandled`).

Today it's also the reply when the addressed actor doesn't exist. That's a different failure: nothing further along would answer it, so falling through is the wrong signal.

Decide whether "no such actor" gets its own reply, and what a caller does with it. Related: `implement-return-unhandled-bv-equivalent-of-a-guard`.
