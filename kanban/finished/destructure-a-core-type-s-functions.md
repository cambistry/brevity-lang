---
created: 2026-11-25
---
# Destructure a core type's functions

```brevity
:before, :after, :trim = Text
:contains, :take, :from = List

field = (front Text, key Text) -> front |> after("\n#{key}:") |> before("\n") |> trim
```

Want: a plain destructure, no `use`: `Text` is core, not a dependency, and `use :div = HTML` is already "the same destructure" as `:value = DB.lookup(:key)` (`notes/use-as-binding-2026-11-18.md`). Renames as usual (`size: textSize = Text`).

Today (checked on js): inside a function body, `:size = Text` then `size("abc")` compiles. At file level, `:size, :slice = Text` fails: "Unexpected token at top level: SIGIL 'size'". File level is where it's wanted, since several actors share the names.

Want (also): `size` and `slice` exist on both `Text` and `List`, so destructuring both is a redeclaration (rename one, or keep them qualified). `repeat` is a keyword, so `:repeat = Text` must fail cleanly.

**Decided (2026-11-26):** a core type's function is called qualified (`Text.after(t, "x")`) or by a name destructured from the type (`:after = Text`, then `after(t, "x")`). The bare-call rule for Text's functions (`atBareBuiltinCall`) goes, and existing bare calls migrate. A destructure works at file level, shared by the file's actors, and in a body; renames as usual; a name taken from two types is a redeclaration; a name the type lacks is an error; a keyword (`repeat`) fails as a parse error.
