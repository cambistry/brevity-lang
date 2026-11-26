---
status: queued
created: 2026-11-20
---
# gaps in `super` implementation

Today:

- super on both branches of an if in a constructor block is reported as not supported yet.

- Writing a parent block's public cell from outside, through the child block, isn't supported.

- Writing through class::base (class::base::x <- v) isn't handled, and I haven't checked whether it fails cleanly.

- << on an inherited name doesn't work, as before; ticket 2 said that's a separate ticket.

**Decided (2026-11-26):**

- **`super` on both branches of an `if`:** allowed when every path calls it exactly once (an
  `else` required); twice, or none, on a path stays an error. Statements before the `if` run
  before the parent is built, as before a plain `super` statement.
- **A parent block's public cell, written from outside through the child block:** the child's
  block forwards `$set` and `$subscribe` for an inherited cell to the parent's block, as it does
  reads. The cell answers at the child's address, `:Q` (outsiders needn't know where it's
  declared).
- **`class::base::x <- v`:** `class` is meaningful only in an instance, so in a class block
  `class::` is an ordinary error. From an instance, `class::base::x <- v` writes the parent
  block's cell under the rule `class::x <- v` follows. A class block whose actor is itself an
  instance of another class: investigate-a-class-actor-that-is-an-instance-of-a-class.
- **`<<` on an inherited name:** not this ticket.
