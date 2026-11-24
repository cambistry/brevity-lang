---
status: done
created: 2026-11-11
---
# Protected names take a leading . on the wire (.val, .helper)

I've written the decision up in notes/protected-names-dot-prefix-2026-11-11.md. No code has changed yet.

**What's decided:**

- On the wire, a protected label takes a leading ., so the cell val is .val and the function helper is .helper.
- The dot means public in source but protected on the wire. Those are two spellings at two levels, and neither changes meaning.
- Because . is a delimiter, the existing local/global rule already reads .val as local. So a protected label can now lead a relative address, which the singleton note couldn't do.
- The convention only covers messages that already exist. val <- x stays a direct store; whether it should go through the bus is left out.

**What** **the** **change** **would** **touch,** **in** **order:**

1. **Self-send** **ops** **and** **their** **dispatch** **arms**, in all three targets: "helper" becomes ".helper".
- This reaches lambda labels too (_lambda_N becomes ._lambda_N), because a protected function held as a value is its op label.
- The capture tests that match /^_lambda_/ would need updating.
1. **A** **set path** **for** **protected** **cells.** {op: [[v], "#set"], to: ".val"} would be answered for internal senders only, matching how #set with to: '…@count' already works for public cells. The JS selector becomes [.@#]name, and Rust and Erlang each get a matching arm.
1. **Subscriber** **tables** **keyed** **by** **the** **full** **label** (".a", "@a"). This also removes Erlang's shared {cell_subs, "a"} list for protected a and public @a.
1. **Snapshot** **keys**: capture and hydrate would use ".val".

The pseudo-sender check on from stays as it is, including __parent's access to a child's protected functions. The note lists two questions that are still open: private names are guarded by that same check, so they aren't really private on the wire; and who answers to: ".val".
