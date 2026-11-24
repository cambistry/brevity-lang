---
status: inbox
created: 2026-11-02
---
# Constructor blocks bind cells the way handlers do

- **Problem:** cells in a constructor block are stored by a separate path from handler binds, so calls and as behave differently there.

- **Symptoms:**

- A remote call doesn't wait for its reply on Rust and Erlang.

- as isn't checked in the file's own block, which also stores the wrong value on JS and Erlang.

- A self-call in the file's own block doesn't build on Rust.

- A subclass block calling an inherited function stores a whole Object on JS and Erlang (inferred from the code, not run).

- **Done when:**

- Blocks lower to binds followed by a store, for both classes and files.

- lowerClassBlock's in-place wrap, soleValue and Rust's cell_call bind are removed.

- Tests cover remote replies that render and that fail, on all three targets.

- **Check separately:** on JS, the call reaches the parent as an incoming op and the handler never replies. That may be a general problem with remote calls

    from class instances, in which case it needs its own fix.
