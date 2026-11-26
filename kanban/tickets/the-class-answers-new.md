---
status: done
created: 2026-11-23
---
# The class answers `$new`

Per notes/class-of-and-self-return-2026-11-23.md, a `$new` reply comes from the class: `{ re: ['#<:1>'], ty: [':'] }`, and the class's parent translates both. Today a file answers `new@Box` itself with `#<:Box:1>` / `:Box` (src/codegen/javascript/classes.js:130-133; erlang preambles.js:2007; check rust). A file that declares `new` already replies `#<:1>` / `:`.

- A class declared in a file builds its reply relative to itself; the file translates it under the class's label (`:1` → `:Box:1`, `:` → `:Box`) on the way out, as it does for an instance's messages (#_publishAt).
- Callers outside see the same reply as today. No test's expected wire should change; if one does, look at why before updating it.
- All three targets.
