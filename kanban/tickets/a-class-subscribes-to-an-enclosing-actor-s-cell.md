---
status: done
created: 2026-11-19
---
# A class subscribes to an enclosing actor's cell

  Rule (notes/private-names-lexical-2026-11-16.md): an inner scope reaches

  every name of the scopes containing it — read, write, call, subscribe.

  Reads, writes and calls from a class to an enclosing actor's names work

  (outer reads, src/outer_reads.js). Subscribe doesn't: a class doing

  \`c.subscribe (v) { … }\` on its file's \`c\` fails to compile on every

  target ("subscribe: target must be self…").

‌

  Investigate

‌

- The shape: the class's subscribe should register with the enclosing

    actor (\`$subscribe\` to its cell, through the outer-reads path that

    already carries \`$get\` / \`$set\`), and that actor's writes notify the

    class across actors, as a subscribe to any other actor's cell does.

- Today a protected or private cell's writes notify only when the

    actor's own code subscribes to it (src/published_cells.js inserts the

    CellNotify only then). With subscribers in other actors that rule has

    to widen: to any cell an inner class subscribes to (still decidable

    from the file), or to every protected/private cell.

- An enclosing actor answers \`$subscribe\` to a protected/private cell

    only from inside; a class declared in it counts as inside (as for

    \`$get\`). Check each target honors that for \`$subscribe\`.

- Instance lifetime: what happens to the subscription when the instance

    goes away (if instances can go away yet).

‌

  Done when a class at depth 1 and 2 subscribes to its file's protected,

  private and public cells, sees the current value and each later write,

  on js, rust and erlang; rows added to lexical_scope.test.js.
