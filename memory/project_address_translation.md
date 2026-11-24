---
name: CAM address translation
description: The parent-layer does address translation, not the sender. Local-vs-global via leading-char rule. #<…> delimiter with space between alias and selector.
type: project
originSessionId: 3e2f2931-ce69-4c8d-bc5f-f01f02b8dfa9
---
Core principle: actors do NOT know their own addresses ("contextual"). They emit messages in their own coordinate system. The **parent** — the layer that holds the child and knows its address — is the one that translates on outbound.

**Why:** "Outgoing" translation would require the sender to know its own address. It doesn't. The parent does.

**Rules at the parent routing seam (harness / runtime):**

- Payload `#<@N>` / `#<#N>` → `#<selfAddr @N>`. Space between alias and selector. One-scan parseable.
- Missing `from` → filled in with selfAddr.
- Local-form `from: '@N'` → prepended to `'selfAddr @N'`.
- `to` is translated the same way as the other address fields (corrected by the user 2026-11-11; an older version of this note said it was left untouched).

**Delimiter (landed 2026-04-23):** `#<alias selector>` — `#<` opener, single `>` closer.
- Replaced the old `<<alias selector>>` form (double-angle pair).
- Rationale: `<<…>>` collides with HTML/XML-like payloads; `#<…>` is one char shorter and carries URL-fragment / content-addressing semantics (Bluster alignment).

**Escape rule (narrow, contextual — implemented 2026-04-23):**
- Inside addresses: `\>` → literal `>`, `\\` → literal `\`
- Outside addresses: `\#<` → literal `#<`, `\\` → literal `\`
- Encoder helpers: `encAddr` in `src/codegen/javascript/statements.js`, `unescAddr` in `src/codegen/javascript/index.js`

**Local vs global discriminator (definitional):** leading character inside `#<…>`:
- Non-word-char start (`@`, `#`) → local, prepend.
- Word-char start (letter) → global, leave alone.

**Why:** This is how the pre-parser knows what to translate without reasoning about scope. The rule is *definitional* — globals MUST always begin with a word character. File-path dep paths therefore MUST NOT begin with `/` (breaks the rule). Paths are `factory.bv` or `folder/file.bv`, never `/factory.bv`.

**How to apply:** When adding translation at a new routing seam (e.g. Rust/Erlang cross-process, browser runtime route), mirror the regex rewrite pattern from `src/codegen/browser/brevity.js` (Phase 3). Translation is opt-in via `compileOptions.selfAddr` so existing tests that assert exact shape stay unaffected.
