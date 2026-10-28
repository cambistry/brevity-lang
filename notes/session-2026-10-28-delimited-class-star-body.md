# Delimited class: `(params) *{ body }` — 2026-10-28

IMPLEMENTED, green: js / rust / erlang on the 24 changed test files (522
passed each), plus browser on the 8 suites that exercise inline-script headers
(352 passed). The second half of moving `*` from the params to the body. It
follows `session-2026-10-28-lineal-constructor-stars.md`, which did the lineal
header. Service-type / interface-document syntax is unchanged; that's the next
pass.

## Grammar

```
C = (params) *{ body }        C = (params) -> *{ body }    — optional arrow
C = () *{ body }              C = -> *{ body }             C = *{ body }
Sub = (Base | params) *{ … }  Wrap = (Base *name | params) *{ … }
Greeting = (Base |) *{ "hello" }                           — ingest / declaration return
@C = (params) *{ … }          C << (params) *{ … }
( deps ) *{ body }            ( deps ) -> *{ body }        — file-level
(value: Integer) *{ return value }                         — old file tail form
```

- Spacing is allowed: `(params) * {`. After a `(…)` (or `->`), `*` followed by
  `{` is always a class header, never multiplication. `x = (a) * 3` is still
  multiplication.
- The class is detected by looking ahead past the matching `)` for
  `[->] *{` (`isDelimitedClassStart`). The same check finds a file-level
  `( deps )` header, as distinct from a body statement that starts with `(`.
- The optional arrow is supported for classes only. Named functions still
  reject `(params) -> { body }`; loosening that is a separate change.
- `C = param -> *{ … }` (a single bare param) is not supported. A bare param
  would be generic, which may not apply to classes.

## Removed forms (clean break, with diagnostics)

- `*(params) { … }`, `*() { … }` and `*(Base |) -> expr`: "`'*(params) { ... }'`
  is retired … write `'(params) *{ ... }'`"
- the file header `*( deps ) { … }` / `*( deps )` + `return …`: "`'*( ... )'`
  file headers are retired"

Not affected: the service-type uses of `*(`, i.e. coercion `as *(p) -> { iface }`
and the dependency entry `(Alias) *(a: Integer) -> { iface }`, plus the DOM
manifest and the emitted interface docs.

## Implementation

- `parser.js`: `isDelimitedClassStart(i)` and `parseDelimitedClass(op)`, wired
  into the public (`@C =`), named (`C =`, `C <<`, including `C =` LF
  `(…) *{`) and file-level paths. `parseConstructorAfterStar` now rejects
  `*(`. File-level `*(` is a retired-form error.
- The ASTs are identical to the old forms. Checked old syntax on the previous
  parser against new syntax on the new parser for: params, public, `()`,
  overload, wrap subclass, ingest, file header with deps, and the file tail
  form.
- `codegen/browser/runtime.js`: `hasHeader` recognizes `( … ) [->] *{`, `*{`
  and a lone `*` (string-aware paren match).
- Messages and comments in `parser.js`, `validate.js`, and the js/rust
  `statements.js` updated to the new form.

## Migration

- Tests: 319 sites in 23 files (scripted), plus hand edits to
  `classes/delimited_form` (rejected forms → retired forms), `syntax/star`,
  `syntax/file_class_grammar`, `classes/lineal_form`, and the
  `classes/file_params` comment.
- Docs and agent-resources: code blocks migrated for both this change and
  the lineal-header change (which the earlier pass missed in docs), and the
  prose updated. Many doc code blocks were already unparseable before this
  change (prefix-colon params and other retired syntax). They were not fixed
  here, and a before/after parse check showed no new failures.

## Incidental

- Lint cleanup in touched files: removed the write-only `_lastIsWhile` and the
  unused `lookupCatchJsLabel` from `codegen/javascript/statements.js`, and two
  useless initializations in `validate.js`.
