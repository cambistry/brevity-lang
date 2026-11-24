---
status: done
created: 2026-11-21
---
# Extension docs: publish a class block's protected interface

  Design: notes/opre-extend-and-as-2026-11-20.md ("The extension doc").

‌

- Every actor is extensible for now, so every class block's service doc gains an

    extension section: its public and protected functions (name, arity, types) and

    protected cells (name, type). A block that extends another presents the composite:

    its own names and what it inherits.

- parseInterface reads the section back.

- The child's override table is computed from the parent's extension doc, not its AST:

    the \`block\` section, with the parent's public and protected names that the child

    defines or redeclares, \`~\` on protected ones. An override of a name the parent doesn't

    declare, or with another arity or type, is a compile error in the child.

- A subclass's block always has a base: its parent's block, empty when the parent has

    none (a root's block has no base). An empty base has nothing in it: \`super\` there is

    the compile error it is for any name the parent block doesn't define.

- Phase 1 is local, so the parent's doc is generated from its source in the same

    compile; the table must still be built only from the doc.

- Tests: rendering and reading back the section; the computed table for overrides,

    redeclared cells and inherited names; the compile errors.

- Not in scope: the \`instance\` section, sealing, cross-file parents.
