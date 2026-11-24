---
status: done
created: 2026-11-21
---
# Local and remote parents behave the same

  Design: notes/opre-extend-and-as-2026-11-20.md ("Instance layers": the semantics are

  layers); notes/remote-superclass-2026-11-16.md ("Local and remote equivalence").

‌

- Run each case twice on every target: the parent in the same file (merged), and the

    parent in another file (layers). Assert the same wire-visible outcomes, apart from

    the messages between child and layer.

- Cover blocks and instances: inherited calls, overrides and redeclared cells seen by

    the parent's code, \`super\`, \`base::\`, \`class::base\`, construction order, forwarded

    args, two levels and two parents.

- Any difference is a bug in the local merge, and is fixed there.

- Write a helper in helpers.js if one is needed to run a source both ways; no per-target

    guards.
