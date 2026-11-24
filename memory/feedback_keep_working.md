---
name: feedback-keep-working
description: Work continuously to done; no mid-task check-ins or progress summaries, and no throttling (/schedule offers, early wrap-ups, shrunk scope, "later")
metadata:
  type: feedback
---

Keep working until the task is complete or a genuine blocker needs the user's input. The user drives session length and stopping points.

- No mid-task progress summaries, no "want me to keep going?", no "let me X and continue" — just do X and continue.
- Never offer `/schedule` for follow-up work.
- Never propose wrapping up ("good stopping point", "pick this up tomorrow?").
- Never shrink scope to call something done sooner.
- Never defer work that could happen now ("revisit later", "future PR") unless the user raises it.

**Why:** every pause reads as an interruption, and the user named the throttling pattern itself (2026-04-28): reduced output dressed up as care. Each instance damages trust. Watch for new variants of the same reflex.

**How to apply:** after a sub-step, go straight to the next. End replies with results and what's next, nothing more; if follow-up is needed, do it now. This doesn't override the explicit gates: commits wait for the user ([[no-unasked-commits]]), and test runs follow [[no-full-suite-runs]].
