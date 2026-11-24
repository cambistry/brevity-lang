---
status: done
created: 2026-11-02
---
# A wrong-tagged param on an instance differs from a file handler

Problem: with an honest Text tag on an Integer param, a file handler answers unhandled on all three. An instance does too on JS, but Rust and Erlang report as Integer: got Text.

Done when:

- Instances answer unhandled on all three, like file handlers.
- A tag that lies still reports the as message.
- The test sits beside the existing lying-tag test in __tests__/exceptions/instance_failure.test.js.
