---
status: done
created: 2026-11-19
---
# Remove the `spawn` keyword

`call...` is the only way to fire and forget. Remove `spawn` so the language reads as if it never existed: no detector, no special-case error, no migration wording. `spawn` stops being a keyword and becomes an ordinary identifier (outer_reads.test.js already has an `@spawn` function). `spawn x()` then fails the way any unknown input fails, where the parser meets it.

Keep the SpawnStatement AST node only if it's still the internal form for a local `fire...` (src/validate.js:2580). If so, consider renaming it (e.g. LaunchStatement) so nothing is named after the removed keyword.

Scope:

- Lexer: drop 'spawn' from KEYWORDS (src/lexer.js:1).
- Parser: remove the `spawn` statement path (src/parser.js:4155-4161). Update the settleFireAndForget comment (parser.js:6809), which mentions `spawn`.
- Validate: remove `spawn`-only branches. `...` keeps its rule: the callee must be silent (`name.`), bang (`name!`), or documented as silent.
- Codegen (js/rust/erlang): keep whatever the `...` path uses. Remove anything only `spawn` reached.
- Tests: rewrite `spawn f.()` as `f...` and `spawn X.m.(args)` as `X.m.(args)...` in keywords/spawn.test.js (fold into functions/silent.test.js or rename), functions/silent.test.js, functions/lineal_form.test.js, operators/semicolon.test.js, cam/interop.test.js.
- cam/external_send.test.js `spawn Remote.get(:url)`: this starts a read and discards it, which `...` rightly refuses. Change the case to a silent or bang remote op (e.g. `get. (url: Text) => .` with `Remote.get.(:url)...`) so it still tests an outgoing send with no reply wait. Don't drop it.
- Docs: remove `spawn` from LANGUAGE_FEATURES.md, LANGUAGE_OVERVIEW.md, docs/. Leave dated notes alone.

Done when: grep finds no `spawn` keyword handling in src/, and the full `npm run test` is green on js, rust and erlang.
