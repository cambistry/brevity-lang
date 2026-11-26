---
created: 2026-11-01
---
# Construct a public class from another file

Construction in the class's own file now works.

Svc.W() fails with 'Svc' has no function 'W' even when the doc lists W () -> *{…}, with or without !. Constructor entries are stored in __types, which member-call lookup doesn't search for this call.

To decide: how a caller reaches a public class (Svc.W(), a header binding, or both) and what wire op it uses. Docs key a ! class as W! but print its type as W, so a reader of the doc has to connect the two.

Done when a class constructed from another file runs on js, Rust and Erlang, and W! counts as a write for its caller.
