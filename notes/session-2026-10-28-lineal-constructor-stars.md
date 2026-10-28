# Lineal constructor header: `*` … `*` — 2026-10-28

IMPLEMENTED, green on all four targets (js on the 53 changed files: 623 passed;
browser 3408, rust 2728, erlang 2728 passed).
Phase 1 of the actor-`*` rework: only the **lineal** constructor header changes.
Delimited constructor syntax (`*(params) { }`, `* { }`, `*(Base |) -> expr`) and
all service/type-document syntax are untouched (phase 2).

## Grammar

```
Name [LF] =          Name [LF] =          Name <<          (file: no prefix)
*                    *                    *
params, one per line body                 params
*                    .                    *
body                                      body
.
```

- Each `*` must be the **first and only token on its line** (surrounding
  whitespace allowed). The closing `*` may also be followed by `{` (delimited
  body), on the same line or the next.
- No params: the opening `*` is followed directly by the body. Telling params
  from body uses the same rewind trick as lineal functions: read a run of param
  lines; if a lone `*` follows, they were params, otherwise rewind and treat it
  all as body.
- Lineal bodies still end at `.` / `end` (named) or EOF (file).
- `return` / tail logic is unaffected — a lineal body whose only statement is
  `return x` is just a lineal body.
- The leading `=` (or overload operator) is required: `Name *…` and `Name\n*`
  are errors.
- File headers use the same grammar; their entries are the full file-header
  entry grammar (dependencies, `HTML: (:div)`, `:document`, scalar params), one
  per line.

## Removed forms (clean break, each a diagnostic)

- `Name = *` with params on following lines (star not alone on its line)
- `* =`, `Name * =`, `=*=`, `*=` (no-params lineal on one line)
- the `=` closer after a lineal param run (`a lineal constructor header is
  closed by '*' alone on its line, not '='`)
- a paren header with a lineal `=` body: `*(…) =` and `*(…)` LF `=` — named and
  file-level (`'=' no longer opens a constructor body` / `… file-level class
  body`)

## Implementation

- `lexer.js`: STAR tokens carry `alone` (only token on its line) or
  `aloneBeforeBrace` (first on its line, followed only by `{`). Computed from
  source text because `;` also lexes as NEWLINE, so token adjacency can't
  enforce "alone on its line".
- `parser.js`:
  - `tryParseLinealConstructorParams` (replaces `parseLinealConstructorParams`)
    — speculative param run closed by `isClosingStar`, with rewind; one param
    per line.
  - `parseConstructorAfterStar` — lone star → lineal header; otherwise only
    `(` or `{` may follow.
  - `parseConstructorBody(op, linealHeader)` — `=` opener removed.
  - The named/public entries require `=` before `*`.
  - **File headers:** the entry loop of `*( … )` is now
    `parseFileHeaderEntries(isEnd)` (plus the hoisted `tokText` /
    `parseInlineIface` / `parseAsTypeSuffix`), shared by the delimited and
    lineal headers. Post-header handling is `parseFileHeaderBody(linealHeader)`.
- **AST unification (bug fix):** lineal file params used to land on the file
  actor's `initParams`, while the paren header made them `FileParam`
  dependencies. That meant the lineal form left them out of the `params`
  document. Both forms now produce identical `dependencies` (tested in
  `file_class_grammar.test.js`).
- `codegen/browser/runtime.js`: the implicit `document` DI prepended to inline
  `<head>` scripts is now the lineal header, and header detection recognizes
  `*(`, `* {` and a lone `*`.
- No codegen change on any target (the AST shape is the same).

## Behavior change to note

Without a closing `*`, the lines after the opening `*` are the body, so
`Name =`/`*`/`value Integer` (no closer) now parses as a no-params class whose
body declares `value Integer`. It used to be an error. A typed param run
followed by a lone `=` still gets the targeted diagnostic.

## Tests

- Migrated about 460 sites across 53 test files (scripted: lone-`*` + `=`,
  `= *` headers, `*( … )` + `=` to lineal entries one per line; plus a few
  one-line string fixtures by hand).
- Rewrote `syntax/star.test.js` (lineal sections, header comment),
  `syntax/file_class_grammar.test.js`, `classes/lineal_form.test.js`. These add
  accept/reject cases for: alone-on-line enforcement, whitespace around stars,
  `* {` vs `*` LF `{`, no-params rewind edge cases (`count *Integer = 0`, a
  nested lineal class), the retired `=` closer, missing leading `=`, lineal
  overloads, public lineal classes, lineal dependency entries, and lineal/paren
  AST parity.

## Not done / follow-ups

- Lineal **function** syntax (`f =` LF `/` args `/` …) — backburnered.
- Delimited constructor rework (`(args) *{ }`) and service-doc syntax — phase 2.
- Tensile (external) may encode the old lineal header grammar.
