---
status: done
created: 2026-11-04
---
# Rust test harness: let tests show that a call waits for its reply

  sendAsync in src/codegen/rust/index.js replays every message so far into a fresh process (spawnSync with the whole history on stdin). A call waiting on a reply that

  hasn't been sent yet hits end of input, await\_response returns Null, and the actor carries on. So no test can assert that a caller's reply comes after a dependency's answer. constructor\_block.test.js ("gets its reply back through its file actor") checks only the final reply for this reason. Options: keep one process

  alive, as the Erlang harness does, or have end of input make a pending wait fail visibly instead of returning Null. Once that's done, tighten that test to check the order.
