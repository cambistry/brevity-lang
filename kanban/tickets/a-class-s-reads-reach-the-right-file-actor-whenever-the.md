---
status: done
created: 2026-11-03
---
# a class's reads reach the right file actor, whenever the class runs

- **Erlang, idle file actor.** A class read hangs when the file actor is sitting on stdin rather than waiting on the class. That happens after a fire-and-forget call to

    the class, or in a subscription callback. The likely fix is to move stdin reading into its own process, so the file actor always answers in a receive.

- **Rust, Self() file actors.** A class constructed by a Self()-spawned file actor reads the main file actor's cells. Either handle\_op\_at uses the outer_states stack,

    or each class records which file state it belongs to.

- **Cells holding actors.** A file cell that holds a class actor, read from another class. Each backend passes actors in-process in a different form: a handle on JS, a

    pid on Erlang, w/1 on Rust. This one may need nothing beyond a test.

‌

  These belong together because the reads already work. Each is a case where the backend reaches the wrong actor, or can't reach it at that moment, and the test

  pattern is the same for all three. The fix for the Erlang idle case is the same machinery that writes and calls need, so you could fold this ticket into the

  writes-and-calls one. That would leave only one new ticket.
