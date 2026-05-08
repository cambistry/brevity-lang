# Void return — `()` as the empty-reply marker

Date: 2026-05-07. Implemented the parser-level `Void` (`()`) representation that
makes `re: []` a first-class wire form, distinct from silent (`-> .`).

## Surface forms

All of the following produce the same AST and the same wire reply (`re: []`):

- `() { }` — empty body, delimited
- `() { () }` — body whose tail is `()`
- `() { -> () }` — explicit `-> ()` inside a body
- `() -> ()` — single-line lambda
- lineal `=\n  { }`
- lineal `=\n  ()`
- lineal `=\n  -> ()`
- lineal `=\n  ->()` (no space)

`{ }` is *not* the empty service block at the value level — it's an empty body
that returns Void. The empty service block is its own thing (constructor body).

`()` is **not a value** — it's a parser-level marker meaning "no value here."
The parser carries it as `returnType: '()'` on `Function` nodes (parallel to
`returnType: '.'` for silent), and as `Reply` nodes with empty `fields` for
public handlers.

## Wire form

- Silent (`.`): no `re` field at all (the message just isn't replied to).
- Void (`()`): `re: []` (an empty positional array).
- Valued: `re: [v1, v2, …]` or `re: { name: v }`.

## Where `()` is legal

- Tail of a function body
- Immediately after `->`
- Trailing in a constructor service block (no-op — the constructor returns the
  instance address, not a value)

Anywhere else, the validator rejects it: cannot bind, cannot use in an
expression, cannot pass as an argument, cannot use as a reply field. Error
messages follow the form `"…'()' is not a value"`.

## Implementation footprint

Target-agnostic:

- `src/parser.js`: `parseFunction` `->` arm handles `() -> ()`; LBRACE arm
  normalizes empty body and trailing `Return([])` to `returnType = '()'`;
  `parseFunctionBody` accepts bare `()` as a tail Void marker; `parseBody`
  pushes `SilentTerminator` for the `-> .` synonym (was previously empty);
  `parseActorBody` accepts trailing `()` and `-> ()` in service blocks as
  no-ops.
- `index.js` (interface emitter): `formatPublicFnSig` distinguishes silent
  (has `SilentTerminator`) from void (empty body or empty Reply) and prints
  `() -> ()` accordingly.
- `src/validate.js`: silent-detection now requires an explicit
  `SilentTerminator` (matches codegen). New `checkVoidFunctionUsage` rejects
  binding/using `()`-returning calls.

JS codegen:

- `src/codegen/javascript/expressions.js`: `genReBody` returns `'[]'` for
  empty fields (was emitting `{ }` for the named branch).
- `src/codegen/javascript/classes.js`: lambda dispatch arm with
  `returnType === '()'` runs the body for side effects then sets `re = []`.

Rust codegen:

- `src/codegen/rust/statements.js`: `genRustReBody` returns
  `Value::Array(vec![])` for empty fields. ExprStatement codegen for direct
  private-fn calls bypasses `genRustExpr`'s trailing `.one()` wrapper —
  otherwise calling a void fn in statement position would panic at
  `Structure::one()` on the empty positional vec.
- `src/codegen/rust/handlers.js`: handler emission default branch (no Reply,
  no ImplicitReturn, no silent) emits `re = Some(Value::Array(vec![]))`.
  Lambda emission with `returnType === '()'` and empty body emits the same.

Erlang codegen:

- `src/codegen/erlang/statements.js`: `genReplyBody` returns `[]` for empty
  fields.
- `src/codegen/erlang/program.js`: handler dispatch default branch emits
  `{ok, [], null}` when not silent (was emitting `{ok, null, null}` which
  suppressed the reply).

## Tests

- `__tests__/functions/void_return.test.js`
- `__tests__/constructors/void_return.test.js`
- `__tests__/services/interface.test.js` — new "void-returning public functions"
  describe block.

Full suite: **3185 pass, 0 failures** across js + rust + erlang + browser
(144 test suites total).

## Notes for future work

- The compile-error test for "cannot return `()` from a function declared to
  return Integer" was removed — the syntax `->(result Integer)\n=\n…` is
  malformed, and the deeper feature (type-checking lambda return against an
  annotated return type) is a separate concern. Replaced with "cannot use
  `()` as a reply field value."
- Lineal-form private fns inside a public-handler body aren't a supported
  shape — they get promoted to file-top-level and conflict if multiple
  handlers declare the same name. Use top-level lineal definitions instead,
  or inline lambdas (`fn = (…) { … }`).
- Rust's `Structure::one()` panics for non-1 positional length. The void
  ExprStatement codegen sidesteps this by emitting `genRustFnCallExpr`
  directly (no `.one()`) when calling a private fn in statement position. If
  more value-discarding contexts emerge, a more general solution (tracked
  void-name set + skip `.one()` for void calls) might be cleaner than the
  per-context bypass.
