---
status: done
created: 2026-11-10
---
# The constructor block skips validateBody

  Top-level statements don't get the checks that handler bodies get: method existence, remote signature and argument types, field-set rules, annotation

  requirements. They only get the dependency-constructor argument check. For example, Svc.gret(…), Svc.greet(name: 5), t.zz() on a local class and

  document.bdoy() all compile at top level but are rejected inside a handler. The docs/site/ examples are written entirely at top level. This is blocked on

  ticket 3.
