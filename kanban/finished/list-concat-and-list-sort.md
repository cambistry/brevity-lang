---
created: 2026-11-25
---
# `List.concat` and `List.sort`

Want:

- **`List.concat(lists)`** flattens a list of lists one level. With `map` it replaces the `reduce` that collects each item's lines: `List.concat(map(cards) (card) { cardShape(card) })`.
- **`List.sort(list) <fn>`** with a trailing comparator: `List.sort(unlisted) (a, b) { a.created > b.created }`, where the function says whether `a` sorts before `b`. Stable. Decide whether a key form (`List.sort(xs) (t) { t.created }`) is also wanted.

Both appear in `kanban/speculative/board.bv`.

**Decided (2026-11-26):**

- **`concat`:** nothing to build. `List.flatten(lists)` already flattens a list of lists one level; `List.concat(a, b, …)` joins lists.
- **`List.sort(xs) fn`** takes a function, as a trailing block or `&f`: with two params a comparator, true when `a` sorts before `b`; with one, a key, sorted in natural order. Stable. Ascending only: a comparator covers the rest.
