---
status: investigation
created: 2026-11-25
---
# Investigate: a dot chain on a cell derives a live cell

Today: only cells receive messages; a plain value can't (`Text.before(x, …)` on a value, `t.before(…)` on a cell `t *Text`, per `__tests__/core_types/text_methods.test.js`). So in `list.filter(…).map(…)` each step must return a cell for the next call to land, which makes the result a new cell, not a mutation.

Want (proposed split):

- **`|>` chains values:** `cards |> List.take(i)`.
- **A dot chain on a cell derives a live cell:** `open = all.filter((t) -> t.status != "done")` stays current as `all` changes, and can be subscribed to.

To investigate: whether a derived cell is live or a one-time copy (live is what distinguishes it from `|>`); its lifetime and the subscription it holds on its source; what `<-` on a derived cell means (an error?); how replies carry one; and whether dot calls that only want the current value (`cards.size`) should then be written `List.size(cards)`.
