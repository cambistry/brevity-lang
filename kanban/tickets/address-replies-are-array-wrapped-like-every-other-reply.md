---
status: done
created: 2026-11-19
---
# Address replies are array-wrapped, like every other reply

  Summary

‌

  A reply is positional: \`re: [v]\`, \`ty: [t]\`. Replies that carry an

  address break the rule and go out bare:

‌

- \`$new\`: \`{ re: '#<:Box:1>', ty: ':Box' }\`

- a self-return (a \`!\` function that falls off its end, \`return self\`):

    \`{ re: '#<:>' }\`, \`{ re: '#<:C:1>', ty: ':C' }\` from an instance

- a bare \`Self\` handler body: `{ re: '#<[c.bv](http://c.bv "‌")\>', ty: 'Class' }`

‌

  Meanwhile an address held in a variable and returned (\`return k\` of a

  class value, \`return c\` of an instance) already goes out wrapped:

  \`{ re: ['#<:N>'], ty: ['Class'] }\`. Same value, two shapes. Wrap them

  all.

‌

  Semantics

‌

- \`$new\` replies \`{ re: ['#<addr>'], ty: ['<class address>'] }\`:

    \`{ re: ['#<:Box:1>'], ty: [':Box'] }\`; for a dependency's class,

    `ty: ['[thing.bv](http://thing.bv "‌")']\` / \`['[svc.bv](http://svc.bv "‌"):Counter']`.

- A self-return replies \`{ re: ['#<:>'], ty: [':'] }\` (\`:\` = my class,

    as a \`self\` slot is tagged today); from an instance, after the parent's

    translation, \`{ re: ['#<:C:1>'], ty: [':C'] }\`.

- A bare \`Self\` replies `{ re: ['#<[c.bv](http://c.bv "‌")\>'], ty: ['Class'] }`.

- Receiving: a \`$new\` reply (a dependency's construction, \`t = Thing(…)\`)

    and a call that returns self read the address from \`re[0]\`. A bare \`re\`

    is no longer an address reply.

‌

  Work

‌

- js: classes.js \`$new\` / \`new@\` arms (\`re = '#<:' + …\`), the bare-Self

    arm (\`this.constructor.classAddress\`), self-return (\`re = "#<:>"\` /

    \`"#<:>"\` fallbacks), `\_bv\_lift`/parent translation that special-cases

    `[http://msg.re](http://msg.re "smartCard-inline")  === '#<:>'\` and fills in \`ty`.

- rust: \`$new\` arms, `bv\_swap\_self\` / \`dispatch_at`'s

    `result.as\_str() == Some("#<:>")\`, bare-Self (\`ty\_re = "Class"`),

    self-return \`json!("#<:>")\`.

- erlang: \`$new\` / instance-construction replies, \`{ok, Addr, <<"Class">>}\`

    for bare Self, self-return, await\_new\_response_ and friends.

- Browser runtime: anything that reads a \`$new\` or self-return reply.

- Receivers on every target: new-reply handling for dependency

    construction (the \`#<Thing/9>\` path), remote-instance handling, chains on

    a \`!\` call's result.

‌

  Tests

‌

- Update every expectation of a bare address reply (~34 files with \`$new\`

    shapes, ~7 with \`re: '#<:>'\`) and every mocked incoming \`$new\` reply

    (`{ re: '#<[thing.bv:9](http://thing.bv:9 "‌")\>', ty: '[thing.bv](http://thing.bv "‌")' }` → wrapped).

- New: one test per reply kind (\`$new\` local, \`$new\` of a dependency's

    class, self-return from the file and from an instance, bare \`Self\`),

    asserting the wrapped shape on js, rust and erlang.

- A bare \`re\` arriving as a \`$new\` reply is not taken as an address

    (pick: error, or treated as a malformed reply — see To decide).

‌

  To decide

‌

- Incoming bare \`re\` for \`$new\`: reject outright, or accept for a

    transition? (Recommend reject: no external peers depend on it yet.)

- A self-return's \`ty\`: \`[':']\` (as a \`self\` slot is tagged now), or

    omitted?

‌

  Done when no reply on any target carries a bare \`re\`, on js, rust and

  erlang (no target skipped).
