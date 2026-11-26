---
created: 2026-11-24
---
# Fix: parse errors carry no position

Problem: many parser errors have no line, and the thrown error has no position fields: `Unexpected token in expression: NEWLINE 'undefined'`, `Expected RPAREN, got SIGIL 'columns'`, `Unexpected token in while body: IDENT 'grid'`. Some resolve-stage errors do (`'bump' is not defined (line 3)`). In a 577-line file the only way to locate one was bisecting by top-level block. The `'undefined'` token text is a second small bug. Found writing `kanban/board.bv`.
