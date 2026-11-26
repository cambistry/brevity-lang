---
status: inbox
created: 2026-11-13
---
# Error replies don't say which member an intrinsic op failed on

**Background.** notes/at-sigil-internal-and-quoted-names-2026-11-12.md retires compound op names like set@val, subscribe@val, get@val and new@Good. Intrinsic ops now name their target in to instead:

```
{op: [[7], '#set'], to: '@ val'}
{op: [{}, '#new'], to: '@ Good'}
```

Today: an error reply's ex is keyed by the op that failed. ex: {'set@val': 'error'} says which cell failed. After the change it reads ex: {'#set': 'error'}, which names neither a cell nor a class.

**Who's affected.**

- **Callers matching on id:** not affected; they know what they sent.
- **People reading a reply on its own,** in logs, traces or test failures: they lose the target.
- **Any code that dispatches on the ex key:** it can't tell #set on a from #set on b. None is known today.

**Options.**

1. **The key is the op plus the target, relative to the replying actor:** ex: {'#set val': 'error'}. It reads like a tiny address and keeps today's information.
1. **The reply's from names the address that was asked** (… val). That puts the detail where addressing already lives, but replies don't carry from in test outputs today, so it's a wider change.
1. **Accept the loss** and rely on id correlation.

**Not urgent.** For now this is option 3. Revisit if logs or traces need the target, or if something starts dispatching on ex keys.

**Example sites:** exceptions/instance_failure.test.js:577, :587 (new@Good), and the set@val tests in operators/ref.test.js.
