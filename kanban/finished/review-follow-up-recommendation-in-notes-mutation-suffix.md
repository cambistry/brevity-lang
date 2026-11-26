---
created: 2026-10-31
---
# review follow-up recommendation in notes/mutation-suffix-2026-10-31.md

btw says:

Phases 1–3 are done, and most of the note is covered once phase 4 lands. That covers effect inference, the checks table, untracked in source, ~> spreading through generated docs and the corpus migration. This list is from our conversation, as I can't re-read the note from here.

**Worth filing now (bugs and gaps):**

1. **Remote chain misroutes on a value (Rust, Erlang):** remote.pop!().name assumes any remote ! returns self, so the next call goes to the wrong place. Docs now state => self, so the compiler could check this. I said phase 3 could do that, but it didn't, and it isn't in phase 4's scope.
1. **@x(…) self-calls don't compile on Rust:** because of this, bump!(1).add!(2) is a compile error on every target for now.
1. **Generated docs for mixed return paths:** they show only the tail return, so pop! with both return v and return self is documented incompletely.
1. **Classes named with !:** W! is renamed W__w in the AST, so generated docs show that name, and the annotation x W! is an error.
1. **Bare (untracked: Integer) param:** reading it in the body fails with a generic error, not a message suggesting the rename form.

**Worth filing as future work (from the note):**

1. **Chain pipelining:** use the self-return guarantee to avoid a round trip per call.
1. **Hand effect data to the transaction work:** this includes treating -> and ~> differently, and possibly deciding "verified" by how a doc was produced, since a hand-written -> can't be checked.
1. **Wire-name alias:** a Brevity actor serving a foreign op named push has to name it push!, so the wire names don't match. Deferred because nothing needs it yet.
1. **What <- yields as a value:** this needs a wire form for a returned cell, and it's tied to the cross-actor cell handoff already deferred in param_capabilities.test.js. Until then it's a compile error, and the expression form covers local cells only.

**Check before filing:**

- **File constructors:** "widget.bv": Widget! (a: Integer) => *{ … } is settled but not implemented, and it was never assigned to a phase. Either add it to phase 4 explicitly or file it.
- **10-30 leftovers:** the spawn vs ... review and lambdas filling silent slots were still open in that session's note. They aren't part of this work, so they may already be filed.
