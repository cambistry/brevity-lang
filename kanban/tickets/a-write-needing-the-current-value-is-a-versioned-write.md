---
created: 2026-11-27
---
# A write that needs the current value should be a versioned read, compute, write

Design: `notes/file-views-and-codecs-2026-11-27.md`, "Writes check a version". Depends on `a-cell-of-a-view-type-takes-writes-through-self-set`.

Today: a cell write stores the value it's given.

Want: every write that needs the current value (a `set` that takes it, a derived element write,
`<!`) compiles to: read `(value, version)`, compute, write on condition that the version hasn't
moved, and retry on conflict. A write that replaces the whole value is one unconditional write.
A local cell has a trivial version, so behaviour is unchanged today; this is the seam a File
plugs into.

Decide: how many retries before giving up, and the failure reply the caller then handles.
Every target.
