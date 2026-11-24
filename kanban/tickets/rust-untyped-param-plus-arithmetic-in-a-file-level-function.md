---
status: done
created: 2026-10-29
---
# Rust: untyped param plus arithmetic in a file-level function doesn't compile

double = (n) { n * 2 } called from a handler fails cargo build: cannot multiply &Value by &BigInt.

- **Cause:**
- A generic private function compiles to a self-send op with n: Value.
- The rust runtime has no arithmetic for values of unknown type.
- **Works:** js and erlang, and the same function defined inside a handler on rust.
- **Options:**
- generate a typed copy per call site;
- add a runtime helper that picks the arithmetic by value type (Integer/Decimal).
- **Test:** double = (n) { n * 2 } and @test = { result Integer = double(21); return :result } should give 42 on all targets.
