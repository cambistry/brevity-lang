---
created: 2026-10-29
---
# Docs still use the retired prefix-colon param syntax

Commit 4b5a78f retired (:name Type) in favour of (name: Type). Several docs still use the old form.

- **Files:**
- docs/SYNTAX_CRIB.md
- docs/LLM_WRITING_BREVITY.md
- agent-resources/brevity-writing/references/compact-language-profile.md
- agent-resources/brevity-writing/references/demo-safe-patterns.md
- check LANGUAGE_OVERVIEW.md
- **Instances:** param lists like @echo = (:text Text) and @query = (:key Text), and service-doc signatures like lookup: (:key Text) -> (:value Text).
- **Leave alone:** statement destructures like :value Text = DB.lookup(:key) are valid, as is the (:key) argument shorthand.
- **Overlap:** the service-doc signatures and the dependency-entry form *(:path Text) -> {…} will change anyway in the service-type notation work (phase 2), so those could wait for it.
- **Check:** run a before/after parse of each code block (as in the delimited-class pass) so no new failures appear.
