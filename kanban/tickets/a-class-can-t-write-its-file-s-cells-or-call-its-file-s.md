---
status: inbox
created: 2026-11-03
---
# A class can't write its file's cells or call its file's functions

**Problem:** A class can read the cells of the file actor it's declared in (notes/session-2026-11-03-class-reads-file-cells.md). It can't write them or call the file's functions. Both are compile errors on every target:

```brevity
total *Integer = 4
@title *Text = "box"
f = (n Integer) { return n * 2 }
@g = { return 6 }
bump! = { total <- total + 1 }

W = *{
  @reset! = { total <- 0 }              // Cannot set 'total' — only 'ref' variables and actor references support '<-'
  @retitle! = { @title <- "lid" }       // refused the same way
  @double = { x Integer = f(3); return x }   // 'f' is a function of this file, and a class can't call it yet
  @six = { x Integer = @g(); return x }
  @bumpIt! = { bump!() }
}
```

A class closes over its file actor, so both should work, just as reads do. Each is a message to that actor: a set for a write, and a call for a function. They go to the actor that made the class, so Svc.W() and s.W() write to and call different actors.

**Behaviour:**

- **A write is the file actor's write.** The file's subscribers to @title are notified, as they are when the file writes it itself. Later reads, by the file or by any of its classes, see the new value.
- **A call runs on the file actor, against its state.** A ! function called from a class writes the file's cells, not the class's.
- **The file actor answers while it's waiting.** A call from a class can arrive while the file actor is waiting on that class. It's handled then, as reads are today.
- **The file's private functions take these calls.** A class is in-process, so it counts as an inside sender.

**To decide:**

- **Does a class function that writes its file's cells need !?** It writes another actor's state, not its own. Today ! means "this function writes". It also decides whether a caller can treat the call as a read.
- **Does calling a file's ! function from a class make the calling function a write?** The same question, for calls.

**Implementation notes, from the reads work:**

- **JS:** the get@ route through #outer / _route can carry a set or a call as well. The file actor dispatches it with from: '__child', which every private-function gate needs to accept.
- **Rust:** outer_states[0] is the file's state while a class runs. A write can go into it directly. A call has to swap the file's state back into self.state, run handle_op, then swap it out again, pushing the class's state in the meantime.
- **Erlang:** the file actor's waits (bv_await_ and the others) already serve bv_outer_get. They need a clause that runs handle_op, or the set, and replies.
- **Remove both compile errors:** checkCall in src/outer_reads.js, and the <- refusal for file cells.

**Related gap:** on Erlang, a file actor sitting idle on stdin can't answer a class. This ticket makes that more likely to come up. Fix it here, or file it separately.

**Done when:** the same behaviour on JS, Rust and Erlang, with tests covering:

- a class writes a private cell and a published cell, and the file's subscribers are notified
- a class calls a private function, a public function and a ! function of the file
- a write or call from a class is seen by a later read from the file and from another class
- Svc.W() and s.W() write to and call their own actors, end to end
- whichever ! rule is chosen
