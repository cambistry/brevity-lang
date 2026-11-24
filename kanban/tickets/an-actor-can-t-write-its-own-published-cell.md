---
status: done
created: 2026-11-01
---
# An actor can't write its own published cell

@a *Integer = 3 with @bump! = { a <- a + 1 } fails with Cannot set 'a' — only 'ref' variables and actor references support '<-'. Writing @a <- @a + 1 fails with The left side of '<-' must be a cell. Both fail at file level and inside a class, with or without inheritance. Setting the cell from outside (s.a <- 9) works.

notes/mutation-suffix-2026-10-31.md shows untracked @log *Text = "" written as log <- log + m, so the bare-name form looks like the intended one. Confirm that, then make it work.

Done when an actor's own function can write its published cell on js, Rust and Erlang, and subscribers see the change.
