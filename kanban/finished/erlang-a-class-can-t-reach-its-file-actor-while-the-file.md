---
created: 2026-11-04
---
# Erlang: a class can't reach its file actor while the file actor is idle

A class process asks its file actor for two things:

- Reads of file cells (bv_outer_get_).
- Calls on a file dependency named directly (bv_outer_call_). The file actor sends the call on the wire under its own id and passes the reply back.

The file actor answers these only while it's waiting on something (bv_await_, bv_await_ready_, bv_await_wire_, bv_await_emit_), and that's true whenever one of its classes is running for it. When the file actor is idle, blocked on stdin in read_loop, nothing answers, and the class hangs.

A class runs while its file actor is idle when:

- a caller launches one of its functions (w.go.()...);
- a subscription callback or an emit handler runs it;
- it's been handed out and is called directly from outside.

Other messages a class sends (#new to a dependency's class, calls on an actor it holds) go straight to the wire, on the counter it shares with its file actor. Those don't need the file actor to answer, but the class then reads stdin to wait for its reply while the idle file actor reads the same stdin.

**Fix direction:** stdin needs a single reader that hands each message to whoever is waiting for it. The file actor should keep reading stdin even while idle, as a process that dispatches each message and serves its classes' requests in the same receive, instead of blocking in io:get_line. Classes would then wait on Erlang messages, never on stdin.

**Tests:**

- A launched call into a class that reads a file cell.
- The same for a class that calls a file dependency.
- A subscription callback in a class that does either.

Each currently hangs on Erlang.
