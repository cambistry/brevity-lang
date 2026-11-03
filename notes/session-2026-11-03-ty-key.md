# Session 2026-11-03 — wire key `bv-a` renamed to `ty`

The CAM message key for type tags is now `ty`. It is the same field, with the same
values and positions, on requests and replies. Only the key changed.

- Renamed in all codegen and runtimes (JS, browser, Rust, Erlang incl.
  `brevity_router.erl`), tests, `LANGUAGE_OVERVIEW.md`, `USAGE.md`, `docs/`, and
  the undated-in-spirit design notes (`mutation-suffix-2026-10-31.md`,
  `type-authority-address-tags-2026-10-26.md`, `reference-fields-in-types-2026-10-26.md`,
  `cam-naming-and-dialects-2026-05-15.md`, `hash-exceptions-2026-05-11.md`).
- Left as `bv-a`: session logs, older dated design/plan notes, and `kanban/4 - done/`.
  They record what was true when written; read `bv-a` there as `ty`.
- Internal identifiers that abbreviated the old key were renamed too, on every target:
  `bva` → `ty`, `Bva`/`BvA` → `Ty` (e.g. `genBvaBody` → `genTyBody`, `structure_splat_bva`
  → `structure_splat_ty`, `Send_bva_N` → `Send_ty_N`, `_bva_re` → `_ty_re`). The JS `as`
  helpers `_bvAs*` are not this abbreviation and are unchanged.
- Quoted keys stay quoted (`'ty':`, `msg['ty']`); they could be unquoted later.

## Next (scoped, not started): `ty` describes real data, without `#<…>`

**Rule (user, 2026-11-03):** `ty` describes the value actually sent. It never holds
a union or a placeholder such as `Anything`. `ty` is a translated field, like `to`
and `from`, so its tags need no `#<…>`.

**Unions/`Anything` today (violations):** replies are tagged with the declared type:
`{ result: 'Integer | null' }` with `re: { result: 42 }`. Tests that assert this:
`core_types/null`, `keywords/if`, `keywords/reduce`, `types/type_union`
(16 lines); `'Anything'` in `core_types/list.test.js:170`. Fix: when the declared
slot type is a union or `Anything`, tag from the value at runtime, as
`List of Anything` already does (`_List.typesOf`, `javascript/expressions.js:1372`),
reusing the kind functions (`_bvAsKind` JS, `bv_as_kind` Erlang, Rust's `bv_as`
kind). `null` is tagged `'null'` (already used). A type value in a union needs its
authority tag at runtime, not just `__type`.

**Translation:** strings in `ty` (at any depth) that start with `@`, `#` or `:` get
the sender's address prepended (`::Point` → `geometry.bv ::Point`, `@Counter` →
`Svc @Counter`); strings that start with a word character stay as they are. This is the
`from` rule plus `:`. Sites: `browser/brevity.js:429` (JSON-string regex, needs
a walk), `browser/runtime.js:2260`, `javascript/classes.js:1114`,
`javascript/index.js:159`. Rust/Erlang have no in-process relay.

**Emitters:** `tagFor`s (`javascript/expressions.js:1315`, `rust/types.js:233`,
`erlang/types.js:15`); class tags at `javascript/classes.js:131,1122`,
`rust/handlers.js:303`, `rust/program.js:1727`, `erlang/program.js:633`,
`erlang/preambles.js:704`, `browser/runtime.js:997,1954,2016,2152,2209,2217`.

**Readers:** already accept the unbracketed form (`wire.js:31`, `bareName` in
`javascript/preambles.js:650`, `bv_type_name` in Rust/Erlang), except JS
`isTypeTag` (`preambles.js:661`, needs `::` anywhere, not a leading `::`/`#<`).

**Open: the one-actor-reply check** (`rust/program.js:1760`,
`erlang/preambles.js:1098`): today `re` is `#<…>` and `ty` is `#<…>` without `::`.
Class tags don't always have `@` (`Thing`, `Svc`, `Math` for file classes), so
unbracketed `Thing` looks like `Integer`. Proposal: `re` keeps its brackets
(they mark an address in data); the reply is one actor when `re` is `#<…>` and
`ty` is a string other than `Text`. That holds only if a Text reply that starts
with `#<` is always tagged `Text`, which needs checking.

**Tests:** ~66 lines / 16 files with a top-level bracketed `ty`, plus nested
(`{ coords: '#<::Point>' }`); `type_tag_translation.browser.test.js`.
