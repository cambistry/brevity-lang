---
created: 2026-11-26
---
# A subscription's updates should name their sender, on every target

Subscribing from outside to a public class-block cell, `$sub` to `:P:count`, then writing it:

- JS sends the update with `from: ':P'`, as it sends the first value.
- Rust sends the update without a `from`.
- Erlang sends no update at all: only the first value.

Through a child class block (`$sub` to `:Q:count`, an inherited cell, forwarded to `P`'s block),
JS names `:Q`, and Rust and Erlang send the update without a `from`.

Settle whether an update carries `from` (the address subscribed to), make every target send it
the same, and fix Erlang's missing update for a direct `$sub`. Then tighten the
`expect.objectContaining` in `__tests__/classes/class_singleton.test.js` ("class blocks inherit
by delegation — from outside") to the exact message.
