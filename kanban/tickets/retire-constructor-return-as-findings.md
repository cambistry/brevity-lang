---
status: todo
created: 2026-11-26
---
# Retire constructor return-as: findings

From investigate-retire-constructor-return-as, against notes/constructor-return-as-retired-2026-11-23.md.

## Decided (2026-11-26)

`notes/constructor-tail-and-ingest-retired-2026-11-26.md`: the bare tail value, the file opener and `ingest` all go, and losing memoization is accepted. The TextDiv failures don't block this work; they are filed as `fix-binding-an-element-projection-gives-a-self-contradicting-error` and `fix-reactive-interpolation-in-a-self-as-element-clause`.

## The questions as found

- **Three source forms set `declarationReturn`, not one.** The note covers `return expr` /
  `-> expr` at a constructor tail. There's also the **bare tail value**: a literal, `( … )`,
  `[ … ]`, an HTML literal, or a lone name (`pushValueEmitter`, src/parser.js:4792, called
  from 5413 and 5445). And the **file opener** `return` / `->` (6340). Is the bare tail retired
  too? The note's "has no source form left" implies it. Most tests use the bare tail.
- **`ingest` loses its only supplier.** A subclass fills its parent's `ingest` slot from its
  bare tail (`Sub = Base ^ *{ "hello" }`). Without it, only `ingest(default)` works, as a plain
  default. The ingest tests already call it possibly deprecated
  (`__tests__/classes/ingest.test.js:48`, `__tests__/keywords/ingest.test.js:33`). Retire
  `ingest` (IngestExpr, `inheritedIngests`, the keyword), or give it another supplier?
- **Memoization goes.** A declaration return was evaluated once at init (`__returnAs`); a
  `self as` clause runs on each `$as`, so an element projection is a new node each time.
- **TextDiv can't be written with `self as` today in a way that yields a usable element:**
  - The clause `self as HTML::div = -> <div>{ … }</div>` compiles on all three targets, given
    `use HTML::div` or `use :div = HTML`.
  - But nothing can bind the projection. `el div = tdiv`, `el HTML::div = tdiv` and
    `tdiv as div` all fail in src/public_classes.js:130 ("'HTML::div' names a class, and '::'
    is for types — annotate it 'el div'"), and the suggested `el div` fails the same way.
  - `body.append!(tdiv)` passes the actor's address. Nothing sends `$as`, and the JS-only
    `_tail` unwrap goes with return-as.
  - `{{ text }}` inside a `self as` clause fails on every target ("Unexpected DomConstructor
    child: interp"). The note's `{ text }` is literal text in today's compiler.
  - The alternative, a function returning the element with a cell local, fails ("'text' is
    not defined"). That's pending escaping-frames work.

## Producers and consumers (go with the source form)

- **Parser:**
  - the constructor-tail `else` branch, src/parser.js:4881-4886 (becomes the error);
  - `pushValueEmitter` (4792), if the bare tail goes;
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

`self as` already goes through `asClauses` on every target, so none of this needs a
replacement.

## Tests and docs

- **`__tests__/classes/return_as.test.js`** tests only the retired feature; every site is a
  projection. Move each to `self as T = -> …`:
  - class sites: 12, 25, 37, 49, 64, 81, 97, 107, 121, 132;
  - file-level sites: 224, 245, 259, 280, 298, 324, 356, 375.

  File-level `self as` on the wire is already covered by
  `__tests__/keywords/self_as.test.js:150-256`. So the file can mostly go, keeping one
  compile-error case per retired form.
- **Ingest sites**, decided by the ingest question:
  - `__tests__/classes/ingest.test.js:21, 29, 56, 84, 85, 105, 126, 146`;
  - `__tests__/keywords/ingest.test.js:19, 52`;
  - `__tests__/syntax/star.test.js:397`;
  - `__tests__/classes/subclass_runtime.test.js:224-240`;
  - docs: `__tests__/classes/ingest.md`, `__tests__/keywords/ingest.md`,
    `__tests__/classes/index.md:4, 52, 72`, `__tests__/keywords/index.md:12, 27`,
    `LANGUAGE_FEATURES.md:22, 29`.
- **Grammar tests that the tail parses:** `__tests__/syntax/file_class_grammar.test.js:38-42`
  and 141-148. They become error tests, or move to `return self`.
- **Error tests on the value path** (`__tests__/syntax/unexpected.test.js`):
  - 130-132, "return-as value must not be a function": becomes an ordinary parse error;
  - 138-140, a lone name: a parse or resolve error, depending on the bare-tail decision;
  - 142-144, "emits one value": becomes unreachable;
  - 122-124: stays.
- **No test or doc writes `return <element>`** at a constructor tail. HTML tails appear only
  in notes: from-names-calling-scope-2026-11-14.md:104, scoped-styles-2026-11-09.md:142 and
  325, types-implementation-plan-2026-04-27.md:147.
