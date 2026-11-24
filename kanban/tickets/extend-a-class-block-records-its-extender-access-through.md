---
status: done
created: 2026-11-21
---
# `$extend`: a class block records its extender; `~` access through the record

  Design: notes/opre-extend-and-as-2026-11-20.md ("$extend", "Identity", "Grandparents",                                            

  "Protected names on the wire").

‌

- A block whose parent block exists sends \`{ op: [[{ block: [...] }], '$extend'] }\` to

    it as it is built, and waits for the reply before its own constructor body goes on.

    An empty base gets no \`$extend\`; an empty block between two others is transparent

    (in \`W ^ V ^ T\` with only \`T\` and \`W\` having blocks, \`W\`'s block extends \`T\`'s).

- The parent records the sender, keyed by \`(from, as)\`, with its table, and replies with

    an acknowledgement, or fails with an \`ex\` reply when the table names something it

    doesn't declare. A failure fails the child's build.

- Grandparents: when a block is extended, it sends its own parent a \`$extend\` with

    \`as: <the extender>\`, whose table is the names it or the extender overrides, in the

    parent's terms. Nobody talks past their direct parent.

- The child's reads and writes of a parent cell it doesn't redeclare become \`$get\` /

    \`$set\` of \`~name\` at the parent. They replace the chain privilege: the child block is

    no longer declared inside the parent block.

- Instances of the extending class reach an inherited block cell through their own

    class's block, which forwards it (\`B::count\`, \`class::count\`, and the \`T::h\` family

    access that \`class::base\` uses).

- The parent accepts \`~\` ops only from a recorded extender; the child, only from the

    parent it extended. A private name is reachable from neither.

- Functions are still copied in this ticket (delegation is the next).

- Tests on every target: a shared cell read and written through the child; a

    redeclared cell kept apart; the same through an instance of the extending class; two

    levels registered through the middle block; an empty middle block; a \`~\` op from an

    actor that didn't extend fails; a table naming an unknown name fails the build.

- Not in scope: policy (every actor is extensible), lifetime.
