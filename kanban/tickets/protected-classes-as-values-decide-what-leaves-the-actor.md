---
status: inbox
created: 2026-11-19
---
# Protected classes as values: decide what leaves the actor

Today: `k = C` (C protected) works as an alias inside, and `return k` replies `#<:~C>` — the class's protected label. From outside, nothing answers there: `$new` and member reads to `:~C` are unhandled. Kept as is for now; current code may rely on it.

Options

1. Allow (today): honest address, useless outside, fine if it comes back in.
1. Refuse where it leaves: alias and inside use unchanged; returning or sending it is a compile error ("'C' is protected: as a value it's only usable inside — publish it as '@C'").
1. Refuse as a value at all: only `@C` is a value.

Leaning 2. Revisit once there's real use of class values crossing actors.

Done when the rule is decided, implemented on js, rust and erlang, and tested (inside use, return, send), with the note in

notes/class-scope-and-inheritance-2026-11-18 section updated.
