---
status: done
created: 2026-11-01
---
# Update the docs for !, effect arrows and untracked

**Title:** Update the docs for !, effect arrows and untracked

Do this after "Settle the open effect rules", so it only needs doing once.

**`notes/mutation-suffix-2026-10-31.md`**

Stale text:

- Line 5: status says phase 4 is uncommitted.
- Lines 75, 93, 120: `<-` as a value returns a reference.
- Line 168: a slot named `f!`.
- Line 192: no effect analysis exists.
- Line 198: calling a remote with no read-only doc, which needs checking against `~>` and the may-write rule.
- Lines 238–239: the `untracked` example writes `log`, which doesn't compile.
- Lines 289–290, 317: `~>` details.
- Lines 428–432: phase 1 text on `-> self` and `-> (self)`.
- Line 458: says "local rather than a fixpoint", but `~>` now spreads by fixpoint across the file.

Lines 410–459 can shrink now that the phases are done.

**`notes/session-2026-10-31-mutation-suffix.md`**

Remove the "known gap" about a private class's members leaking into docs, which `aa24eff` fixed.

**Agent docs**

`docs/SYNTAX_CRIB.md`, `docs/LLM_WRITING_BREVITY.md`, `__tests__/functions/index.md` and everything under `agent-resources/` have no mention of `untracked`. The first three have no mention of `~>` either, and `agent-resources/` hasn't been checked for it. Cover:

- `!` writes, `.` is silent, and read-only has no mark.
- Falling off the end returns self, `return v` returns v, and there's no tail return.
- `->`, `=>` and `~>` in signatures only; `-> self` and `=> self`; `=> .`; and which combinations are errors.
- `untracked` on cells, functions and nested actors.
- Chains, and when to bind first.

Check each example by compiling it.
