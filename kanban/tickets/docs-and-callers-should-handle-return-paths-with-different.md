---
status: done
created: 2026-11-01
---
# Docs and callers should handle return paths with different value types

  \@f = (b Boolean) { if b { return 1 }; return "x" } documents f (Boolean) -> (Text), so the Integer path is missing. Docs show one shape, and the

  function's own-level return wins over a branch.

‌

  Callers read one return shape (returns[0]-style lookups in validate.js and types.js), so printing both isn't enough on its own. Printing every path could

  also add noise, because a return with an inferred type prints as arg1: Anything.

‌

  To decide: the notation ((Integer | Text) vs (Integer) | (Text), and what to do with named shapes that differ), and how a caller's annotation is checked

  against several shapes.
