---
created: 2026-11-26
---
# A constructor block returns no value; retire `declarationReturn` and `ingest`

Design: `notes/constructor-return-as-retired-2026-11-23.md` and `notes/constructor-tail-and-ingest-retired-2026-11-26.md` (the newer one wins on `return`). Findings came from `investigate-retire-constructor-return-as`.

Today:

- Three source forms set a constructor's `declarationReturn`: `return expr` or `-> expr` at the end of a constructor block, a value at the end of the block (a literal, `( … )`, `[ … ]`, an HTML literal or a lone name), and the file opener `return expr` / `-> expr`. Each target turns it into an implicit `$as` arm, memoized at init (`__returnAs`), and a subclass's end-of-block value fills its parent's `ingest`.
- `return self`, `return 5` and `-> 5` at the end of a constructor block all compile.
- A bare `return` on its own line at the end of a constructor block fails to parse ("Unexpected token in expression: NEWLINE"). `if n > 1 { return }` compiles; what it does at runtime is unchecked.
- Outside constructors, `->` is already not a return: in a function body, `-> y` compiles to a zero-arg lambda.

Want:

- A constructor block returns no value. Its result is always `self`.
- A bare `return` is an early exit, anywhere in the block, on every target: the statements after it don't run, and the caller still gets the actor.
- `return` with any operand fails with a specific diagnostic, `return self` and `return ()` included, in a class's constructor block and a file's alike. It states the rule with no migration wording, e.g. "A constructor block returns no value: `return` here stands alone".
- `->` gets no constructor meaning: at the end of a constructor block it's a lambda value, as in any body. The constructor-tail `->` branch goes, and so does its "'->' at the end of a constructor block has nothing after it" message; a `->` with nothing after it fails as an ordinary parse error.
- A value at the end of a constructor block is an ordinary expression statement and projects nothing. Warning on an unused value is `warn-on-an-unused-value-in-a-body`, not this ticket.
- **A `return` before `super` fails** (decided 2026-11-26). In a block that calls `super`, every path builds the base once, as with `super` on an `if`'s branches. A bare `return` above the call, on any path, fails: e.g. "'return' in 'Sub' leaves before 'super' builds the base". Write `if (k < 0) { super(0); return }`, or put the `return` below `super`. With the implicit `super` at the top, every `return` is after it.
- `ingest` goes: the keyword, `IngestExpr` and `inheritedIngests`. A child supplies a parent's value by redeclaring it above `super()`.
- `declarationReturn` goes from the AST, with every producer and consumer below. `self as` already goes through `asClauses` on every target, so nothing replaces them. Projections evaluate on each `$as`; losing memoization is accepted.

TextDiv doesn't block this. Its replacement-path bugs are `fix-binding-an-element-projection-gives-a-self-contradicting-error` and `fix-reactive-interpolation-in-a-self-as-element-clause`.

## Sites

Line numbers are as of `3856a1c` and have drifted since. Re-find them with `declarationReturn`, `__returnAs`, `hasReturnAs`, `mainActorReturnAs`, `inheritedIngests`, `IngestExpr`, `pushValueEmitter`, `_tail` and `inlineExpandable`.

- **Parser:**
  - the constructor-tail `else` branch, src/parser.js:4881-4886 (`return` with an operand becomes the diagnostic; a bare `return` parses as the early exit);
  - `pushValueEmitter` (4792), called from 5413 and 5445 (an end-of-block value becomes an expression statement);
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

- **`__tests__/classes/return_as.test.js`** tests only the retired feature. Class sites 12, 25, 37, 49, 64, 81, 97, 107, 121, 132 and file-level sites 224, 245, 259, 280, 298, 324, 356, 375 are all projections. Move any case `self as` doesn't already cover to `self as T = -> …`; file-level `self as` on the wire is covered by `__tests__/keywords/self_as.test.js:150-256`. What remains: a compile-error case each for `return expr`, `return self`, `return ()` and the file opener `return expr`, asserting the diagnostic; and a runtime case that a value at the end of a constructor block projects nothing.
- **Ingest tests and docs go:**
  - `__tests__/classes/ingest.test.js` and `__tests__/keywords/ingest.test.js`, keeping one case that `ingest` fails to compile;
  - `__tests__/syntax/star.test.js:397`;
  - `__tests__/classes/subclass_runtime.test.js:224-240`: becomes a redeclare-above-`super()` case, as in the 2026-11-26 note;
  - `__tests__/classes/ingest.md`, `__tests__/keywords/ingest.md`, `__tests__/classes/index.md:4, 52, 72`, `__tests__/keywords/index.md:12, 27`, `LANGUAGE_FEATURES.md:22, 29`.
- **Early `return`:** a runtime describe per target shape (class and file) where a bare `return` inside an `if` skips the rest of construction, and one where it ends the block.
- **`__tests__/syntax/file_class_grammar.test.js:38-42` and 141-148** test header grammar with a `return value` body. Keep them as header tests, with a legal body such as `@get = -> value`.
- **`__tests__/syntax/unexpected.test.js`:**
  - 122-124, `->` with nothing after it: an ordinary parse error, asserting only that it errors;
  - 130-132, "return-as value must not be a function": `f -> true` resolves as any expression statement does, so it fails only because `f` is unbound;
  - 138-140, a lone unbound name: still fails as unbound;
  - 142-144, "A block emits one value": goes with the rule; two expression statements compile.
- Notes that end a constructor with an HTML value (from-names-calling-scope-2026-11-14.md:104, scoped-styles-2026-11-09.md:142 and 325, types-implementation-plan-2026-04-27.md:147) are history and stay as written.

Done when: no source form sets `declarationReturn`; it, `__returnAs`, `ingest` and their consumers are gone on every target; a bare `return` exits construction early on every target; every `return` with an operand in a constructor block fails with the diagnostic; and the full suite is green.
