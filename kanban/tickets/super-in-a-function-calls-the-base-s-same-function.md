---
status: done
created: 2026-11-20
---
# `super` in a function calls the base's same function

  Design: notes/super-2026-11-19.md ("In a function, \`super\` calls the base's same

  function").

‌

- \`super(args)\` in function \`h\` (protected) is \`base::h(args)\`; in \`@h\` (public),

    \`base.h(args)\`. Lower it to the same BaseCall the \`base\` forms use (src/base_layers.js);

    no parallel path.

- Bare \`super\` passes the current function's args exactly as received. \`super()\` passes

    none.

- One layer up is the parent's definition: in a clause the subclass adds with \`<<\` or

    \`>>\`, \`super\` dispatches over the parent's clauses only. Check whether \`<<\`/\`>>\` on an

    inherited name works today first; if it doesn't, that's a separate ticket.

- In a lambda inside \`h\`, \`super\` is \`h\`'s.

- \`super\` in a function no parent defines is an error. With more than one parent, bare

    \`super\` / \`super(…)\` is an error naming \`super[A](…)\` / \`super[B](…)\`; \`super[A](…)\`

    works for a direct parent only.

- Late binding unchanged: the parent's \`h\`, run through \`super\`, still uses the subclass's

    overrides of other names.

- Tests on every target: public and protected; bare vs args vs \`super()\`; inside a lambda;

    multi-level (each layer's \`super\` is its own parent's); overload clauses; the errors.

- Docs as above.

- Not in scope: class blocks, no-base constructors.
