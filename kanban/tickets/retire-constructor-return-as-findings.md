---
created: 2026-11-26
---
# Retire constructor tail values, the file opener and `ingest`

Design: `notes/constructor-return-as-retired-2026-11-23.md` and `notes/constructor-tail-and-ingest-retired-2026-11-26.md`. Findings came from `investigate-retire-constructor-return-as`.

Today: three source forms set a constructor's `declarationReturn`: `return expr` / `-> expr` at a constructor tail, a bare tail value (a literal, `( … )`, `[ … ]`, an HTML literal or a lone name), and the file opener `return expr` / `-> expr`. Each target turns it into an implicit `$as` arm, memoized at init (`__returnAs`), and a subclass's bare tail fills its parent's `ingest`.

Want:

- A constructor block's result is its actor. `return self` / `-> self` / tail `self` and `return ()` / `-> ()` stay.
- `return expr` / `-> expr` with any other `expr` at a constructor tail fails with a specific diagnostic, stated as the rule with no migration wording, e.g. "A constructor block's result is its actor: `return` here takes only `self` or `()`".
- A bare tail value fails as an ordinary parse or resolve error.
- The file opener `return expr` / `-> expr` fails the same way as the tail form.
- `ingest` goes: the keyword, `IngestExpr` and `inheritedIngests`. A child supplies a parent's value by redeclaring it above `super()`.
- `declarationReturn` goes from the AST, with every producer and consumer below. `self as` already goes through `asClauses` on every target, so nothing replaces them. Projections evaluate on each `$as`; losing memoization is accepted.

TextDiv doesn't block this. Its replacement-path bugs are `fix-binding-an-element-projection-gives-a-self-contradicting-error` and `fix-reactive-interpolation-in-a-self-as-element-clause`.

## Sites

Line numbers are as of `3856a1c` and have drifted since. Re-find them with `declarationReturn`, `__returnAs`, `hasReturnAs`, `mainActorReturnAs`, `inheritedIngests`, `IngestExpr`, `pushValueEmitter`, `_tail` and `inlineExpandable`.

- **Parser:**
  - the constructor-tail `else` branch, src/parser.js:4881-4886 (becomes the diagnostic);
  - `pushValueEmitter` (4792), called from 5413 and 5445;
  - the file opener (6340);
  - the collector (5491-5500, including "A block emits one value: this one has two");
  - plumbing at 4142, 4717, 5237, 5278, 5299, 6331, 6350, 6473, 6489-6492;
  - the field in src/ast.js:28-29.
- **Walkers:** src/singleton_classes.js:69, 348, 600, 615, 714; src/type_paths.js:246;
  src/base_layers.js:26; src/actor_values.js:153; src/super_calls.js:290 (keep its
  `stateVarDecls` half); src/names.js:274.
- **JS:**
  - `hasReturnAs` and the `$as` arm (src/codegen/javascript/classes.js:633, 983-989, 1051,
    1088-1090, 1159);
  - ingest (1074-1078);
  - the `_tail` mirror (1095-1103) and its reader, src/codegen/browser/runtime.js:948-953;
  - `inlineExpandable` (classes.js:1966-1983, expressions.js:818-851);
  - the `memoized` as-clause branch (statements.js:659-665).
- **Rust:**
  - `genRustDispatch`'s param and `$as` arm (src/codegen/rust/program.js:391,
    handlers.js:590, 639-643);
  - `__returnAs` (program.js:625-633, handlers.js:1063-1064, 1201-1206);
  - the `active` filter (program.js:3065);
  - the memoized clauses (program.js:3157-3159, statements.js:58-75);
  - the child `$as` arm (handlers.js:930-935);
  - ingest (handlers.js:1185-1190).
- **Erlang** (src/codegen/erlang/program.js):
  - `mainActorReturnAs` (1579-1581, 603-607);
  - `__returnAs` (921-925, 1770-1778, 1142-1146);
  - the child `$as` clause (1053-1057) and its guard (1078-1079);
  - ingest (1127-1131);
  - `isActive` (2382);
  - the memoized clause (2438-2440), plus statements.js:380-415.

## Tests and docs

- **`__tests__/classes/return_as.test.js`** tests only the retired feature. Class sites 12, 25, 37, 49, 64, 81, 97, 107, 121, 132 and file-level sites 224, 245, 259, 280, 298, 324, 356, 375 are all projections. Move any case `self as` doesn't already cover to `self as T = -> …`; file-level `self as` on the wire is covered by `__tests__/keywords/self_as.test.js:150-256`. What remains is one compile-error case per retired form: `return expr`, `-> expr`, a bare tail value, and the file opener.
- **Ingest tests and docs go:**
  - `__tests__/classes/ingest.test.js` and `__tests__/keywords/ingest.test.js`, keeping one case that `ingest` fails to compile;
  - `__tests__/syntax/star.test.js:397`;
  - `__tests__/classes/subclass_runtime.test.js:224-240`: becomes a redeclare-above-`super()` case, as in the 2026-11-26 note;
  - `__tests__/classes/ingest.md`, `__tests__/keywords/ingest.md`, `__tests__/classes/index.md:4, 52, 72`, `__tests__/keywords/index.md:12, 27`, `LANGUAGE_FEATURES.md:22, 29`.
- **`__tests__/syntax/file_class_grammar.test.js:38-42` and 141-148** test header grammar with a tail body. Keep them as header tests, with a legal body such as `@get = -> value`.
- **`__tests__/syntax/unexpected.test.js`:**
  - 130-132, "return-as value must not be a function": an ordinary error;
  - 138-140, a lone name: an ordinary parse or resolve error;
  - 142-144, "A block emits one value": the message is unreachable; the case becomes an ordinary error for a bare tail value;
  - 122-124: stays.
- Notes that show an HTML tail (from-names-calling-scope-2026-11-14.md:104, scoped-styles-2026-11-09.md:142 and 325, types-implementation-plan-2026-04-27.md:147) are history and stay as written.

Done when: no source form sets `declarationReturn`; it, `__returnAs`, `ingest` and their consumers are gone on every target; each retired form has a test that it fails (the `return expr` cases asserting the diagnostic); and the full suite is green.
