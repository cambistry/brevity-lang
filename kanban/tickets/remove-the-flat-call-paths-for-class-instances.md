---
status: inbox
created: 2026-11-02
---
# remove the flat call paths for class instances

Problem: Rust still has a code path from when classes were flattened. For a call on a class instance, it runs the class's handler on the caller's state instead of creating an instance (statements.js, the hasInit checks at lines 1330 and 1686). Those checks ignore initBody, so a class with a constructor block and no params never runs that block, which can hide a failed as in it.

lowerChains hoists the receiver in handler bodies, so those calls take the instance path. It deliberately doesn't hoist loop conditions, so while Box().get() { ... } may still reach the flat path. This is untested, and there may be other ways in.

Done when:

- A test calls a method on a new instance in a loop condition, using a class with a constructor block and no params, and checks that the block ran. It passes on JS, Rust and Erlang.
- The flat paths are deleted, and anything that still reached them uses the instance path (child_X_init_at, child_X_dispatch_at). Adding initBody to the hasInit checks isn't enough, because the class would still run on the caller's state.
- The Rust tests pass with the flat paths gone.

To find the callers, temporarily make the flat paths throw during codegen and run the Rust tests.
