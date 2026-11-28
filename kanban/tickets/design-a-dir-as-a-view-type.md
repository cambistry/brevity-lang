---
created: 2026-11-27
---
# Design: a Dir as a view type

From `notes/file-views-and-codecs-2026-11-27.md`, open question "Is a Dir a view type too?".

Decide: whether a Dir is itself described as a view type over a directory node, with a keyed
presentation whose elements are File addresses. That would make "a cell of cells" a presentation
whose elements are addresses, and might subsume the glob key focus.
