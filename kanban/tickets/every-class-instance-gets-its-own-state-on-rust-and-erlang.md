---
status: done
created: 2026-10-29
---
# Every class instance gets its own state on rust and erlang

**Problem**

‌

  On rust and erlang, an ordinary class compiles to one shared set of state on its parent (the "flattened

  single-instance model"). Constructing it twice reuses the same state, so the second construction overwrites the

  first:

‌

  C = (@n Integer) *{ \@x = -> 1 }

  \@run = { a = C(1); b = C(2); x Integer = a.n(); y Integer = b.n(); return r: x * 10 + y }

‌

  js: r: 12. rust and erlang: r: 22.

‌

  Per-instance state exists only for classes where classNeedsSpawnedInstances holds, i.e. ones that refer to Self

  (rust: instance pool plus child\_<c>\_dispatch\_at; erlang: spawned processes plus {bv\_dispatch, …}). Everything else

  is flattened.

‌

  **Consequences**

- Any program that constructs a class more than once is wrong on two of three targets.

- Class construction in expression position doesn't compile: [C(), C()] (rust: cannot find value C; erlang: unbound

    C). Even if it compiled, both elements would be one actor. 

- Failing tests: classes/instances.test.js (two instances), plus the two lambda-tail cases in

    destructure/remote\_call\_binds.

‌

  **Proposal**

‌

  Give every class per-instance state on rust and erlang by generalising the spawned-instance path that Self classes

  already use:

- C(args) creates a fresh instance and yields its reference (rust: instance id; erlang: pid), anywhere an expression

    can appear: statements, list literals, arguments, returns.

- Calls, field reads and writes, <-, subscriptions and wrapped superclasses dispatch through the instance.

- Optional: keep flattening as an optimisation only where the compiler can prove a class is constructed exactly

    once. Otherwise drop it.

‌

  **Risks**

- Every child-class codegen path on both targets assumes the flattened layout: construction, dispatch, state keys

    (b\_<field>), subscriptions, wrapped superclasses (\_supertypeBindings), and the over special case.

- Self-routing (an instance calling itself) needs the existing deadlock and recursion guards: rust's

    current\_<c>\_instance, erlang's Item_ == self().

‌

  **Acceptance**

- The two-instance test passes on all three targets.

- [C(), C()] compiles, and over(cs) (c) { c.seven() } returns [7, 7] (the lambda-tail tests in remote\_call\_binds).

- rust and erlang pass \_\_tests\_\_/classes, \_\_tests\_\_/self and \_\_tests\_\_/destructure with no regressions.
