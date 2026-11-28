---
created: 2026-11-27
---
# Design: a read-only File or Dir

From `notes/file-views-and-codecs-2026-11-27.md`, open question "A read-only view". The 11-25 sigil table's `&T` row has no spelling
now that the name binds a typed address.

Decide: how a program takes a File or Dir it may read and watch but not write, and whether that is
a type, a capability on the address, or part of the grant.
