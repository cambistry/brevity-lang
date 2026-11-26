---
created: 2026-11-17
---
# Replace braced `**{ }` with `actor { }`; keep `**` for lineal forms

Background

A class is a relationship, not a type: an actor is a class relative to the actors its `new` makes. So the class block needs no class-specific syntax. It is an actor literal. `actor { … }` replaces `**{ … }` everywhere the braced form appears. (Design: notes/ proposal to follow, building on

class-singleton-forms-2026-11-13.md and class-scope-and-inheritance-2026-11-16.md.)

Scope: braced form only

- Singleton:            C = **{ … }                   →  C = actor { … }
- Public singleton:     @name = **{ … }               →  @name = actor { … }
- Nested class:         C = **{ new = (p) *{ … } }    →  C = actor { new = (p) *{ … } }
- `++` composition:     **{ } ++ (p) *{ }             →  actor { } ++ (p) *{ } T ++ (p) *{ } ++ **{ }        →  T ++ (p) *{ } ++ actor { }
- Trailing form:        (p) *{ } **{ }                →  restate as `(p) *{ } ++ actor { }`, or keep a juxtaposed `actor { }` if we decide to; settle this here, because juxtaposition without `++` isn't otherwise a class.

Out of scope (unchanged for now)

- The `**` file header (`**` … `**`) and its lineal entries.
- Lineal singletons (`C = **` followed by members, ended by a blank line).
- `class` as the role word (`class.x`, `class::x`); it already resolves to class_of(self) and isn't affected.
- Making `Cls *{ }` illegal and the new diagnostics (constructor declaring `new`, etc.). Separate ticket.

Work

1. Lexer/parser: `actor` followed by `{` is an actor literal, parsed where `STARSTAR` + `{` is today (src/parser.js, incl. the public-singleton desugar at "@name = **{ body }"). Check whether `actor` is used as an ordinary name anywhere (tests, examples); decide whether it becomes a reserved word or is contextual (keyword only before `{`). Prefer contextual if it costs nothing.
1. Braced `**{` becomes a parse error with a fix-it message: "'**{ … }' is now 'actor { … }'". (No deprecation period; this is pre-1.0.)
1. Codegen: no change expected; the AST should be identical. Verify that generated JS/Rust/Erlang output is byte-identical for converted fixtures.
1. Convert usages: 81 occurrences in 11 test files, plus 11 files in docs/notes/*.md. Notes: update examples in current-design notes; leave historical/superseded notes as written but add a pointer line where it helps.
1. Error messages that mention `**{` (e.g. NEW_RESERVED_MSG in src/parser.js) say `actor { }` instead.

Acceptance

- No `**{` left in src/, __tests__/, or current docs, except in the parse-error test for the old form.
- Lineal `**` header and lineal singletons parse exactly as before.
- Tests pass on JS, Rust, Erlang; generated output unchanged for converted fixtures.
