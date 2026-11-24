---
status: done
created: 2026-11-19
---
# Name resolution — an unbound identifier is a compile error

  Problem

  There is no name-resolution pass. The parser builds Identifier nodes, nothing

  checks them against scope, and every backend writes the name verbatim:

‌

    \@f = -> Thnig

      js     → re = [Thnig];                                   (ReferenceError at runtime, only if reached)

      rust   → re = Some(Value::Array(vec![bv_val(Thnig.clone())]));   (rustc error in generated code)

      erlang → Re = [Thnig],                                    (unbound variable at erlc)

‌

  Worse, a name that happens to be a host global resolves to it:

    \@f = -> globalThis   →   js: re = [globalThis];   (returns the host object)

‌

  What exists instead is a handful of local checks, each covering one case:

- src/published_cells.js:74  — 'x' isn't in scope — the published cell is '@x'

- src/chains.js:169, :179    — 'x' isn't in scope — …

- src/validate.js:2601       — 'f' is not defined — the silent 'f.' is called …

- src/parser.js (end of parse) — builtin namespace methods: 'Text' has no method 'nope'

      (its "names the file binds" collection is a stopgap for exactly this pass)

‌

  Scope

  Add one pass, after parsing (hoisted \`use\`, forward reads and nested

  declarations are all known by then) and before codegen, that resolves every

  identifier in value position, including call targets, dot-call receivers, \`&name\`

  refs, and chain heads. A name resolves to one of:

- a local, param, or cell in an enclosing lexical scope, per the decided rules:

        notes/private-names-lexical-2026-11-16.md

        notes/class-scope-and-inheritance-2026-11-16.md

        notes/forward-reads-in-constructor-blocks-2026-11-11.md

        (src/outer\_reads.js, src/init\_order.js hold the current logic)

- a function, actor, class, singleton, or type declared in scope

- a \`use\` binding or a dependency destructure (notes/use-as-binding-2026-11-18.md)

- a builtin namespace (Text, Blob, GraphemeText, List, Math, Integer, Float,

      Decimal) or a bare builtin function

- self, class, super

‌

  Anything else: \`'Thnig' is not defined\`. Same message for every position.

‌

  The pass becomes the single owner of "is this name bound?". Fold the local checks

  above into it (keep any message that names a real alternative in today's language,

  e.g. the '@x' published-cell hint; drop the rest). Replace the namespace-method

  check's ad-hoc bound-name collection with the pass's scope.

‌

  Out of scope

- Type-position names (\`x Thnig = 1\` also compiles today — separate ticket).

- Arity/argument checking of resolved calls.

‌

  Known dependency

  Tokens carry no line numbers, so the error can't say where. Either add \`line\` to

  tokens in src/lexer.js first, or ship without and follow up. Several existing

  errors already compute an approximate line by counting NEWLINE tokens; that

  undercounts across BLOCK_SEP.

‌

  Expect fallout

  Test sources that lean on unbound names will start failing, as with the

  statement-separator change. Fix the sources; delete tests that only assert a

  form fails with a now-generic message; never skip.

‌

  Acceptance

- \`@f = -> Thnig\` and \`@f = -> globalThis\` fail to compile on every target,

      with \`'Thnig' is not defined\`.

- Each binding kind above resolves, with a test per kind, including: a name

      bound by a \`use\` later in the file, an enclosing actor's cell read from a

      nested class, a param shadowing a builtin namespace name (\`(Math Integer)\`).

- The scattered checks listed above are gone or delegate to the pass.

- js, rust, erlang suites pass.
