---
status: done
created: 2026-11-21
---
# Extension docs: the instance section

Design: notes/opre-extend-and-as-2026-11-20.md ("The extension doc", "$extend", "Several parents").

- A class's extension doc gains its instances' public and protected functions (name, arity, types) and protected cells (name, type), beside the block section. Published params count as public members.
- The child's override table gains an `instance` section, computed from the parent's doc as the block section is: the child's composite, the later parent winning. An override of a name the parent's instances don't declare, or with another arity or type, is a compile error.
- A class sends `$extend` when either section has a parent to go to.
- Tests: rendering and reading back the section; the computed table, including names from a second parent; the compile errors.
