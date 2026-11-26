# Speculative

Brevity written as it is meant to be, not as the compiler takes it today. Nothing here compiles
or runs; the host services it uses are imagined.

- `board.bv`: the kanban board (`../board.mjs`) rewritten as Brevity actors, to see the language
  at the size of a real program. Same persistence: tickets in `../tickets/`, order in
  `.kanban/lists/` on the `kanban` branch.

The notation follows design notes from 2026-11-25, some decided and some only concepts:

- `notes/constructor-star-prefix-2026-11-25.md`: `*(params) { … }` constructors.
- `notes/clause-lists-2026-11-25.md`: `key |> [ … ]` clause lists, `|>` pipes.
- `notes/lineal-definitions-2026-11-25.md`: lineal bodies closed by `end#name`.
- `notes/files-as-addressed-values-2026-11-25.md`: files and directories as addressed values.
- `notes/type-namespaces-2026-11-25.md`: functions bundled on a type.

Other forms it assumes have no note yet: return types in the header (`(params) : Type { … }`),
`*Type?` for nullable, `List[T]`, parens around `if` conditions, `and`/`or`/`not`, line breaks
as separators in multi-line brackets, and destructuring core types (`:trim, :before = Text`).

When a form here changes, or ships, update the file to match or note the gap.
