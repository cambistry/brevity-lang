---
status: done
created: 2026-11-17
---
# `class` and `::`: public members after `.`, protected members after `::`

  Background: discussion of 2026-11-16. The dot means a public member, written by its

  wire name, sent as a message. \`::\` means a name written bare, as declared, in an actor's

  scope: a type (as today) or a protected member. No sigil after either.

‌

  Forms

    class                     the class of the running actor (same as class_of(self))

    class.count               public \`@count\` of my class's class block (message)

    class::total              protected \`total\` of my class's class block

    class.count <- 1          \`$set\` of a public \`*\` cell

    class::total <- 1         \`$set\` of a protected \`*\` cell

    class.f() / class::h()    call a public / protected function

    C.count / C::total        the same, by the class's name

    Svc::Point                a type (unchanged)

‌

  Rules

- After \`::\`, the name is bare. \`class::count\` when the block declares only \`@count\` is an

    error: "'count' is public: write 'class.count'". \`X::@a\` and \`X::#a\` are errors. \`X.@a\` and

    \`X.#a\` already are.

- \`X::name\` is never ambiguous: a type name in scope is reserved, so a member can't share

    it.

- \`C::name\` is allowed only within C's family: C's own actors (their methods, constructor

    block and closures) and C's subclasses' actors. Elsewhere it's a compile error locally,

    and unhandled on the wire, like an outside \`$get\` of \`~hidden\` today.

- Private names are never reached through \`.\` or \`::\`.

- The same in nested and trailing forms. Bare names stay lexical: the nested \`new\` closes

    over its class block; a trailing or \`++\`-composed constructor reaches the block only

    through \`class.\` / \`class::\`.

‌

  Replaces (uncommitted, in the working tree from this session)

- \`C.prot\` reaching a protected member when no public one exists

    (src/singleton_classes.js, lowerMemberAccess): becomes an error pointing at \`C::prot\`.

- The lexer's \`'C.~prot' — a protected member can't be reached through an address yet\`:

    point it at \`C::prot\`.

- \_\_tests\_\_/classes/class\_scope.test.js: its `class\_of(self).prot\`, \`@Nested.prot` and

    \`class_of(self).protFn()\` cases move to \`class::\` / \`C::\`.

‌

  To confirm before implementing

- \`class\` as a reserved word and value: \`class(args)\` constructs (as \`C(args)\` does) and

    \`k = class\` is the class's address. Does \`class_of(self)\` stay as the long form, or

    retire?

- \`class\` vs \`Self\`: \`Self\` today is the file's class (in construction, type and value

    position). Inside a class body the two differ. Keep both, redefine \`Self\`, or retire it?

- \`class\` inside a class block (where the running actor is the block itself): an error, as

    \`class_of(self)\` is today, or meaningful?

‌

  Out of scope

- \`super.\` / \`super::\` (the retire-\`sup\` ticket).

- Atomic read-modify-write on a class block's cell: \`class::total <- class::total + 1\` is

    two messages and can lose updates across instances. That's the separate block/turn

    question.

‌

  Done when, on js, rust and erlang (no target skipped):

- Each form above reads, writes and calls correctly from a constructor block, a method and

    a closure in a method, in the nested, trailing and \`++\`-composed forms, and from a

    subclass's actor (\`T::count\`).

- Each error above fires with its message.
