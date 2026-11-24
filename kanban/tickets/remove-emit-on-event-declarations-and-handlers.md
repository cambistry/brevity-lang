---
status: done
created: 2026-11-19
---
# Remove emit / on (event declarations and handlers)

Remove the `emit` declaration, emit invocation, and the `on src.event { }` handler from the language and from all three targets, so the language reads as if they never existed. `$subscribe` already covers subscriptions. Request/reply emits (`emit check(n) -> (valid Boolean)`) become the subscriber handing the emitter a function address, which is an ordinary call.

No deprecation path: no detector, no special-case error, no message that mentions emit/on/fire, no migration wording. `emit` and `on` stop being keywords. Source that uses them fails the way any unknown input fails, at the point the parser meets it. Do not add a fallback that quietly accepts it.

Scope:

- Lexer: drop 'emit' and 'on' from KEYWORDS (src/lexer.js:1). `on` becomes an ordinary identifier.
- Parser/AST: remove EmitDecl and OnHandler and their parse paths (src/parser.js around 5247 and 7130, src/ast.js:55,58). Leave src/parser.js:261 (`on*` HTML attributes) alone. It's unrelated.
- Effects/validate: remove the emit and OnHandler cases (src/effects.js:93,139,250,443; src/validate.js:2493,4040).
- JS codegen: remove emitNames, the silent-emit tail detection (classes.js:111), the onHandlers wiring (classes.js:375, 838), #_subscribers / _subscribe / #emit /

```
#emitAwait (classes.js:901-930), and emit-call routing (expressions.js:760).
```

- Rust and Erlang codegen: the same removals (rust/program.js:2342,2516, rust/handlers.js; erlang/program.js:892,972,1044,1126,1502,2209,2353).
- Interface/service-document output: drop any `emit` entries.
- Tests: delete __tests__/keywords/emit.test.js. Other files use `emit` incidentally (types/type_actorization, types/scalar_actorization,
browser/xml_text_interpolation.dom, self/self_class, functions/bang, services/interface_notation). Rewrite each case to test the same thing without emit (cell `$subscribe` or a passed function address). Don't drop a case that tests something else.

- Docs: remove emit/on from LANGUAGE_FEATURES.md, LANGUAGE_OVERVIEW.md, docs/. Leave the dated design notes in notes/ as history.

Done when: grep finds no emit/on machinery in src/, and the full `npm run test` is green on js, rust and erlang.
