---
status: inbox
created: 2026-11-16
---
# Private constants and cells

  Private constants and cells: \`#x = 3\`, \`#n *Integer = 0\`

‌

  Per notes/private-names-lexical-2026-11-16.md, every form with a public or protected

  spelling has a private one, in the same places: file, class, class block, function body.

‌

  Today:

- At file, class and class-block level the parser reads any \`#x =\` as a private function.

    \`#x = 3\` fails with "Unexpected token in function body: NUMBER '3'", and

    \`#n *Integer = 0\` with "Expected '=' after private function '#n'".

- Inside a function body, \`#t Integer = 3\` parses, but reading \`#t\` fails at runtime

    (js: \`{"go":"error"}\`), and a lambda that names it fails to parse

    ("Unexpected identifier '#t'").

‌

  Done when, on js, rust and erlang:

- \`#x = 3\`, \`#t Integer = 3\` and \`#n *Integer = 0\` parse in all four positions. The right

    side decides constant vs function, as for \`x = 3\`.

- The declaring scope reads them; \`#n <- #n + 1\` writes a `\*\` cell; a non-\`\*` write is a

    compile error.

- Lexically inner scopes (closures, lambdas, classes declared inside at any depth, a class

    block's nested \`new\`) read, write (\`*\` only) and subscribe to them, as they do for

    protected names today.

- Compile errors: a subclass naming them; \`x.#n\` / \`class_of(self).#n\`; the trailing

    constructor of a class block naming a block's \`#n\`.

- On the wire, a \`#\` cell answers only scopes lexically inside its owner. A \`$get\` of \`#n\`

    from outside is unhandled (compare the protected test "a protected member doesn't answer

    outside the class" in \_\_tests\_\_/classes/class_singleton.test.js).

‌

  Tests: extend \_\_tests\_\_/classes/class\_scope.test.js and \_\_tests\__/functions/private.test.js

  following the existing style (one shared script per describe, literal steps). Never skip a

  target.
