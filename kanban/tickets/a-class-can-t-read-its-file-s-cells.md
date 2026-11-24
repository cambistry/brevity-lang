---
status: done
created: 2026-11-02
---
# A class can't read its file's cells

**Problem:** A class that reads a cell declared in its enclosing file compiles, then fails at runtime on JS. I haven't tested Rust or Erlang.

```brevity
total *Integer = 4

W = *{
  @get = { return total }
}
```

The compiler should either make this work or reject it.

**Why it matters:** The answer decides whether Svc.W() and s.W() can ever differ in behaviour. Svc.W() asks the shared actor to make the class, and s.W() asks the instance s. Today they differ only in which actor holds the new one, because the class can't see either actor's state.

**To decide:** Does a class close over the actor that constructed it?

- **If yes:** the class reads that actor's cells, so Svc.W() and s.W() see different state. Those reads have to go over messages, because the class is its own actor.
- **If no:** reading a file cell from a class becomes a compile error.

**Done when:** The chosen behaviour is the same on JS, Rust and Erlang, and tests cover both the read and the Svc.W() / s.W() difference, if there is one.
