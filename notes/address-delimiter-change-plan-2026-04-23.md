# Address Delimiter Change Plan — 2026-04-23

Switch CAM wire-address delimiter from `<<...>>` to `#<...>`. Escape convention finalized.

## Decision

**Delimiter:** `#<alias selector>` — space between alias and selector preserved from the current form, but the wrapping changes from `<<` / `>>` to `#<` / `>`.

**Why:** `<<...>>` collides with HTML/XML-like payloads (three-angle ugliness when addressifying an XML constructor op). `#<...>` is one char shorter, carries URL-fragment / content-addressing semantics that line up with Bluster, and the 2-char opener (`#<`) makes the escape-burden small because only the exact pair is structurally significant.

**Escape rule (narrow, contextual):**

Decoder:
- `\\` → literal `\` (always, inside and outside addresses)
- `\#<` → literal `#<` (outside addresses only)
- `\>` → literal `>` (inside addresses only)
- `\X` for any other X → literal `\X` (permissive pass-through)

Encoder:
- Literal `\` → emit `\\`
- Literal `#<` outside an address → emit `\#<`
- Literal `>` inside an address → emit `\>`
- Otherwise pass through

Parser disambiguation: a `to`-field starting with `#<` is an address; a `to`-field starting with `#` but not `#<` remains a bare selector (unchanged from current semantics).

Rationale for narrow rule: addresses are path-like identifiers, so `>` rarely appears in them and `#<` almost never appears in surrounding payload. Narrow rule keeps the common-case wire clean; `\\` doubling for literal backslashes is the only always-on cost. JSON stacking means every literal `\` on wire becomes `\\\\` through JSON — acceptable because `\` in addresses is expected to be vanishingly rare.

## Rejected alternatives

- **Revert to backticks**: rejected for debug-tool display concerns (markdown renders backticks as code).
- **Single/doubled quotes**: addresses can contain prose-ish content; `''addr''` uglier than `<<<div>>`.
- **Guillemets `«...»`**: semantically perfect but non-ASCII.
- **Percent-encoding**: transparent to JSON but still anoints `%` as special; no net win over `\`.
- **Doubling as escape (`>>` = literal `>`)**: attractive for opener, ambiguous at close boundary when surrounding payload shares the delimiter char. Fatal flaw.
- **`#<addr>>`** (2-char close): ugly and asymmetric.
- **`#[addr]`**: workable but loses angle-bracket "address" vibe.

## Change Plan

### Phase 1 — Specify delimiter & escape rule

(Documented above.)

### Phase 2 — Update core encoders/decoders

Five source sites:

1. **`src/codegen/javascript/index.js:117-130`** — `parseTo` decoder. Switch `<<...>>` match to `#<...>`:
   - Old: `startsWith('<<') && endsWith('>>')` / `slice(2, -2)`
   - New: `startsWith('#<') && endsWith('>')` / `slice(2, -1)`
   - Add escape-decode pass inside alias/selector extraction.

2. **`src/codegen/javascript/statements.js:92, 710`** — encoders. Change `'<<' + objectName + ' ' + toSelector + '>>'` to `'#<' + encAddr(objectName) + ' ' + encAddr(toSelector) + '>'`. Introduce small `encAddr` helper (escapes `\` and `>`).

3. **`src/codegen/javascript/classes.js:937`** — `re` decoder. Mirror the `parseTo` change (`slice(2, -2)` → `slice(2, -1)`, updated prefix/suffix check).

4. **`src/codegen/rust/types.js:147-152`** — Rust template. Change `starts_with("<<") && ends_with(">>")` / `[2..len-2]` to `starts_with("#<") && ends_with(">")` / `[2..len-1]`. Update accompanying comment.

5. **`src/codegen/erlang/statements.js:163, 685`** + **`src/codegen/erlang/preambles.js:652, 672, 677`** — Erlang encoder template and decoder pattern. Replace `<<"<<"...>>">>` binary pattern with `<<"#<"...">">>`. **Carefully** update the size arithmetic: `Rest:(Sz - 4)/binary` → `Rest:(Sz - 3)/binary` (opener drops from 2 to 2 — `#<` is still 2 chars; closer drops from 2 to 1). Recompute: total wrapper was 4 chars (`<<` + `>>`), now 3 chars (`#<` + `>`). So `- 4` → `- 3`. Verify no other size-dependent arithmetic uses these constants.

Add shared `escapeAddrContent` / `unescapeAddrContent` helper per target (JS, Rust template, Erlang template) so the narrow-escape rule lives in one place per language.

### Phase 3 — Update comments & selector-docs

- Comments at `src/codegen/rust/types.js:147` and similar use prose notation `@<name>` / `#<name>` meaning "hash-followed-by-name." Now ambiguous against the new delimiter — reword to `@name` / `#name`.
- Audit all comments in `src/codegen/*` referencing `<<...>>` wire form.

### Phase 4 — Regenerate target artifacts

- `rust/w1/` through `rust/w7/` are generated test scaffolds. Let the harness regenerate, or clear manually.
- `erlang/w3/`, `erlang/w4/` with their `comp*/` and `inst*/` subtrees — same.
- Per memory: clear `rust/cache/` if it exists to avoid stale-binary false results.

### Phase 5 — Update test fixtures

~103 lines across 14 test files have hard-coded `<<...>>` in expected wire output. Mechanical find-replace per file.

Per memory feedback: default to `--selectProjects js` first, not the full 4-project suite.

Biggest hitters:
- `__tests__/cam/remote_instance.test.js` (4 wire samples, lines 9, 48, 63)
- `__tests__/browser/closure_child.browser.test.js`
- `__tests__/browser/dom_subscribes_to_children.browser.test.js`
- `__tests__/browser/factory_end_to_end.browser.test.js`
- `__tests__/browser/nested_template.browser.test.js`
- `__tests__/browser/element.browser.test.js`
- `__tests__/functions/subscribe.test.js`
- `__tests__/keywords/subscribe.test.js`
- `__tests__/constructors/overload.test.js`
- `__tests__/constructors/dependency_injection.test.js`
- `__tests__/types/type_coercion.test.js`
- `__tests__/core_types/grapheme_text.test.js`
- `__tests__/functions/closure_subscribe_interop.test.js`
- `__tests__/functions/overload.test.js`

### Phase 6 — Update prose docs & notes

- `docs/self-sends-implementation.md` — Erlang wire examples use `<<"op">>` etc. (note: these are Erlang binary syntax, NOT CAM address delimiters — do NOT touch them). Only touch actual CAM address references.
- `notes/layer-a-closure-as-child-2026-04-22.md` — mark escape convention as **no longer deferred**, document new rule.
- `notes/template-static-subtree-inlining-2026-04-22.md` — same.
- Post fresh `notes/session-2026-04-23.md` summarizing decision + change.

**CAUTION:** Many `<<...>>` occurrences in the Erlang-generated code are actual Erlang binary literal syntax (`<<"foo">>` = binary containing bytes "foo"), NOT CAM wire delimiters. Do not change these. Only change strings that represent CAM addresses.

### Phase 7 — Update memory

Update `memory/project_address_translation.md`:
- Replace "space-inside-angles" with "`#<...>`, space between alias and selector"
- Document narrow `\`-escape rule
- Update `MEMORY.md` hook line to reflect new delimiter

## Sequencing

- Phases 1–2 land together (codebase broken until phase 5 completes)
- Phase 5 immediately after phase 2
- Phase 4 regeneration happens as side effect of running tests
- Phases 3 / 6 / 7 batch at end

## Risks

- Erlang binary-pattern match is the fussiest. The pattern `<<"<<", Rest:(Sz - 4)/binary, ">>">>` → `<<"#<", Rest:(Sz - 3)/binary, ">">>`. Size arithmetic must be updated from `-4` to `-3`. Grep for other size-dependent arithmetic in Erlang preambles before editing.
- Distinguishing Erlang `<<...>>` binary literals from CAM `<<...>>` wire delimiters during search-and-replace. Context-check every match rather than blanket-replace.
- Bare selectors starting with `<`: currently `#<foo` would be a bare selector beginning with `<`. After change, `#<foo` is the start of an address. Verify no existing bare selectors begin with `<` (should be true — selectors are identifiers like `#subscribe`, `#name`, never `#<foo`).

## Open questions

None blocking — proceed with plan.
