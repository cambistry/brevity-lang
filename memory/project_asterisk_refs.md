---
name: Capability sigils — evolution of `&`, `*`, and `!`
description: Prefix `&` (read-only ref) and `*` (read/write ref) on scalar types replace postfix `Type!` for cells under the 2026-05-06 v1 decision; v2 promotes interfaces to first-class.
type: project
originSessionId: 3170eed0-69f8-4cbc-8880-e7697a39794c
---

Latest: `notes/capability-sigils-2026-05-16.md` (call-site forms, write
spelling, polymorphic params — **exploratory, not decided**). Prior full
state: `notes/capability-sigils-2026-05-06.md` (v1 decision).

**V1 (decided 2026-05-06, not yet implemented):**
- `Type` — by val
- `&Type` — by ref, read-only (param-side only; no cell declaration form)
- `*Type` — by ref, read/write — REPLACES postfix `Type!` for cells
- Call site: bare `arg` for val/read-only; `*arg` (prefix) for explicit write grant
- Asymmetry rationale: read-only auto-coerces (less than caller's caps); write requires explicit grant. Matches Pony/Rust borrow conventions.

**Sigil history:**
- 2026-03-30 — `*Type` prefix for actor refs (broad meaning), `&` for call-site lending
- 2026-04-25 — type/class split moved actor-ref to postfix `Type!`; `*` retired
- 2026-05-06 — current decision revives prefix `*` (now narrowed to *write*-cap ref) and adds prefix `&` (read-only ref); deprecates postfix `Type!` for cells
- 2026-05-16 (exploratory, not decided) — call-site pressure from reactive cells. Leanings: bare arg self-as-resolves by *narrowing only* (never escalates), caller marker mandatory only in the escalating direction; write glyph leaning `&+` (not `&&` — boolean collision + fails-open typo); `*` stays actorize-only, NOT deref (redundant + inverse-collision); polymorphic params resolve bare to *lowest-common-capability*, error when no unique minimum; optional non-mandatory `as T` for by-value clarity. Auto-accessors for classes probably deprecated (use return-as wrapping)

**`!` after v1:**
- DEPRECATED in type position (`Type!` no longer means cell)
- Possibly retained as method-name suffix convention for mutating methods (`peers.append!(x)`) — orthogonal, doesn't conflict
- Open question: free entirely, or repurposed?

**V2 direction:** structural interfaces as first-class assignable values. Sigils retained as coarse shorthand:
- `&List` ≡ "all read methods of List"
- `*List` ≡ "all methods of List"
- Precise alternative: `PEER_CONTRACT = { append!: ... }`; `<peers: PEER_CONTRACT>`
- Interfaces are a third kind alongside Class and Type — portable behavior shapes (vs Type's portable data shapes, vs Class's actor identity).

**How to apply:**
- Current code still uses `Type!` for cells — v1 not yet implemented. Don't preemptively rewrite working code.
- When discussing FUTURE design or new notes, reference the v1 prefix sigils.
- Several notes (`tail-return-wire-2026-04-15.md`, `type-class-split-2026-04-25.md`) will need amendments once `!` deprecation lands. Treat their `Type!` references as historical, not current direction.
