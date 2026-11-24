---
status: inbox
created: 2026-11-13
---
# `*` on a class-typed declaration

  \`w *W = W()\` declares a writable cell holding a W actor's address. That reads

  as if W were being actorized, and the user expects it to be a syntax error;                                                       

  \`w = W()\` is the canonical form.

‌

  Today:

- The parser synthesizes a setter for actor-reference cells (an address can be

    rebound safely).

- \`@peer *Self | null = null\` relies on this in `\_\_tests\_\_/self/`.

- \`counter *Counter = Counter()\` appears in `\_\_tests\_\_/classes/outer_reads.test.js`

    ("a file cell holding an actor").

‌

  To decide:

- Is \`name *ClassName = …\` an error?

- Is \`*Self | null\` exempt as the rebindable peer form, or does rebinding an

    actor reference need a different spelling?

- What happens to the synthesized setter for actor-reference cells?

‌

  Done when the rule is recorded in \`notes/\`, the parser enforces it with a

  message naming the replacement, and the existing uses are migrated.
