---
status: done
created: 2026-11-20
---
# a braced body ending in an `if` replies with nothing

`@stmt = (n Integer) { if n == 0 { 0 } else { count(n - 1) } }` computes the

  branch value into a temp (`_if0`) but replies with an empty object. Check whether a

  braced body's tail `if` is meant to be its value (as `{ n }` is), and compare

  rust and erlang; add a runtime test on every target.
