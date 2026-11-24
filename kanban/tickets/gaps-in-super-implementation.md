---
status: todo
created: 2026-11-20
---
# gaps in `super` implementation

- super on both branches of an if in a constructor block is reported as not supported yet.

- Writing a parent block's public cell from outside, through the child block, isn't supported.

- Writing through class::base (class::base::x <- v) isn't handled, and I haven't checked whether it fails cleanly.

- << on an inherited name doesn't work, as before; ticket 2 said that's a separate ticket.
