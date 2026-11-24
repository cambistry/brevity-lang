---
status: done
created: 2026-11-10
---
# The DOM manifest doesn't fit the standard document.body().append!(el) idiom

document.body() is declared to return Element, but append! is declared on ParentElement, and it takes a List while the examples pass a single element. Also,

  el = <div>…</div> inside a function body needs a type annotation. The idiom compiles today only because top-level code isn't checked (ticket 2). Fix the

  return type of body (and any similar accessors), the arity of append!/prepend!, and type inference for template bindings.
