---
created: 2026-05-12
---
# could the extract/compile cycle itself be run over CAM? At least conceptually. Are we already doing this in any way?

There is no reason that an interface query has to be within a single compile environment, and no reason that _everything_ needs to be compiled in order for a program to start.

Dynamic compilation implies (I think) that there can be non-typechecked calls to “mount” a service. Though maybe this is a matter of a higher, typesafe layer (“cam”)?
