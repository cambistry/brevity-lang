---
status: done
created: 2026-11-02
---
# f as Function calls differ between targets

**Problem:** g = f as Function; return r: g(1) returned different values in a probe before the as work: a whole Object on JS, 1 on Rust and null on Erlang. It hasn't been re-run since, and it wasn't run without as, so the cause may be how lambdas are called and not as.

**Done when:**

- The cause is identified, using the same call with and without as.
- g(1) returns the same value on all three targets, with tests in the lambda or higher-order suite.
