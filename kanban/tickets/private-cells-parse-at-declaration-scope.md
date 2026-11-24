---
status: inbox
created: 2026-11-19
---
# Private cells parse at declaration scope

`#c *Integer = 1` (and `#c Integer = 1`, `#c = 1`) parses inside a function body, but not at file level or in an actor's body. There the parser reads it as a private function and stops:

Expected '=' after private function '#c'

So a private cell can't be declared where protected (`c`) and public (`@c`) cells can.

Do:

- Parse `#name [Type] = value` at declaration scope as a private cell, as `name [Type] = value` and `@name [Type] = value` already are. `#name = { … }` and `#name = (…) -> …` stay private functions; tell the two apart the same way the protected and public forms do, never by how a name is capitalized.
- Visibility is the lexical rule (notes/private-names-lexical-2026-11-16.md): readable and writable in the declaring scope and everything lexically inside it, including inner actors and actors with a `new`. A subclass (`++`) doesn't see it. Nothing outside sees it. On the wire it's `#c`; an outside `$subscribe` or read of `:#c` is refused as `unhandled` and registers nothing, like `~c`.
- All three targets: declare, read, write (`<-`) and subscribe.
- Tests:
- In __tests__/classes/lexical_scope.test.js, give "a class subscribes to the cells of the actors it's declared in" private-cell rows: depth 1, depth 2, and an enclosing class's private cell. Remove the comment there that says private cells don't parse yet.
- Add the private-cell rows to the "boundaries" describe: refused from outside, refused for a subclass.
- Add a parse test that `#c Integer = 1` at file level and in an actor body is a cell, and `#f = { … }` is still a function.
- Docs: SYNTAX_CRIB and LANGUAGE_FEATURES show a private cell at declaration scope.

To decide:

- Whether a private cell declared in a class body is per instance (like the protected ones), or shared by the class's instances. Per instance is the default.
