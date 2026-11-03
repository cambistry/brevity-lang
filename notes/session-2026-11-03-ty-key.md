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
- Internal identifiers that abbreviate the old key (`bva`, `Bva`, `structure_splat_bva`,
  `Send_bva_N` in the Erlang codegen) were not renamed.
- Quoted keys stay quoted (`'ty':`, `msg['ty']`); they could be unquoted later.
