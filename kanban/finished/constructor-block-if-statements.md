---
created: 2026-11-26
---
# A constructor block takes an `if` statement; remove the branch-`super` shim

A constructor block refuses an `if` statement: `if c { … } else { … }` at a constructor body's
top level is "Unexpected token at top level: KEYWORD 'if'". Only an `if` expression in a binding
works there (`x Integer = if c { … } else { … }`).

The `super` gaps ticket worked around that for `super` on both branches. In src/super_calls.js,
a statement whose `if` calls `super` once on each branch binds the parent's params in each
branch and builds the base after the whole statement. It's limited to a single `if`, not
nested, with each branch calling `super` once as a statement of its own body
(`branchStmt`, `branchLayers`).

- Parse an `if` statement in a constructor block, as a function body parses one.
- Lower `super` in it with the base built where the call is, on its branch: what follows `super`
  in a branch reads the base. Then remove the shim: its error, `branchStmt`, `branchLayers`,
  and "the base is built after the statement".
- Tests on all three targets: `super` in an `if` statement's branches; statements after it in a
  branch read the base; the expression form keeps working.
