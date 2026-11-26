---
status: inbox
created: 2026-11-16
---
# Private constants and cells

Private constants and cells: `#x = 3`, `#n *Integer = 0`

Per notes/private-names-lexical-2026-11-16.md, every form with a public or protected spelling has a private one, in the same places: file, class, class block, function body.

Today:

- At file, class and class-block level the parser reads any `#x =` as a private function. `#x = 3` fails with "Unexpected token in function body: NUMBER '3'", and `#n *Integer = 0` with "Expected '=' after private function '#n'".
- Inside a function body, `#t Integer = 3` parses, but reading `#t` fails at runtime (js: `{"go":"error"}`), and a lambda that names it fails to parse ("Unexpected identifier '#t'").

Done when, on js, rust and erlang:

- `#x = 3`, `#t Integer = 3` and `#n *Integer = 0` parse in all four positions. The right side decides constant vs function, as for `x = 3`.
- The declaring scope reads them; `#n <- #n + 1` writes a `*` cell; a non-`*` write is a compile error.
- Lexically inner scopes (closures, lambdas, classes declared inside at any depth, a class block's nested `new`) read, write (`*` only) and subscribe to them, as they do for protected names today.
- Compile errors: a subclass naming them; `x.#n` / `class_of(self).#n`; the trailing constructor of a class block naming a block's `#n`.
- On the wire, a `#` cell answers only scopes lexically inside its owner. A `$get` of `#n` from outside is unhandled (compare the protected test "a protected member doesn't answer outside the class" in __tests__/classes/class_singleton.test.js).

Tell a private cell or constant from a private function the way the protected and public forms do (`#f = { … }` and `#f = (…) -> …` stay functions), never by how a name is capitalized.

Tests: extend __tests__/classes/class_scope.test.js and __tests__/functions/private.test.js following the existing style (one shared script per describe, literal steps). Never skip a target. Also:

- In __tests__/classes/lexical_scope.test.js, give "a class subscribes to the cells of the actors it's declared in" private-cell rows (depth 1, depth 2, an enclosing class's private cell), and remove the comment there that says private cells don't parse yet. Add private-cell rows to the "boundaries" describe: refused from outside, refused for a subclass. Rows for a file actor, a class and a class block: read, write (cells), subscribe.
- A parse test that `#c Integer = 1` at file level and in an actor body is a cell, and `#f = { … }` is still a function.

Docs: SYNTAX_CRIB and LANGUAGE_FEATURES show a private cell at declaration scope.

To decide: whether a private cell declared in a class body is per instance (like the protected ones) or shared by the class's instances. Per instance is the default.
