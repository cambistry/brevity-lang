---
name: feedback_published_cell_is_at_name
description: Inside its own actor a published cell is `@a`; a bare `a` means a private (protected) cell, even where a note's example suggests otherwise
metadata:
  type: feedback
---
An actor reads and writes its published cell as `@a` (`@a <- @a + 1`). A bare `a` is a separate, protected local attribute.

**Why:** the user corrected me after I took `log <- log + m` in a design note as authoritative; the note's example was wrong.

**How to apply:** a design-note example isn't proof of the rule. When a ticket says "looks like the intended form", check it against how existing tests and generated code use the form before recommending it.
