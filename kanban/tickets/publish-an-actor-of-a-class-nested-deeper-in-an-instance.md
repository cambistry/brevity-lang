---
status: inbox
created: 2026-11-26
---
# Publish an actor of a class nested deeper in an instance

An actor of a class declared directly in an instance body is published under that instance
(`#<:Outer:1:~Inner:1>`), and one of a class in a class block under its class (`#<:~A:~B:1>`).
A class nested deeper inside an instance, such as one declared in the class block of a class
that an instance body declares, has no site (src/codegen/class_sites.js returns null). An actor
of it leaves unpublished, as the in-process value: `{}` on JS, `null` on Erlang, a pool id on
Rust.

Its address should be its encloser's address and its token, as for the direct case, with the
encloser found from the chain of actors it's declared in.
