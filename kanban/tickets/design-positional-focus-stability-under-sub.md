---
created: 2026-11-27
---
# Design: positional focus stability under `sub`

From `notes/file-views-and-codecs-2026-11-27.md`, open question "Positional focuses move".

```brevity
sub lines[3], (l) { … }
```

If another writer deletes line 1, `lines[3]` now refers to a different line. A keyed focus is
stable; an indexed one is not.

Decide: whether a `sub` on, or a held reference to, an indexed focus follows the element or stays
on the index.
