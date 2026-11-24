---
status: done
created: 2026-11-21
---
# Class block extension: a block in another file

  Design: notes/opre-extend-and-as-2026-11-20.md; notes/remote-superclass-2026-11-16.md.

‌

- \`B = A ^ { … }\` where \`A\` comes from \`use\`: the child compiles against \`A\`'s published

    extension doc, sends \`$extend\` across, and runs as in the local case.

- Tests on every target, with the parent as a separate actor: the cases of ticket 4,

    plus a parent whose extension doc is newer than the one the child compiled against

    (fails at \`$extend\`).

- Not in scope: trust boundaries and policy, instances.
