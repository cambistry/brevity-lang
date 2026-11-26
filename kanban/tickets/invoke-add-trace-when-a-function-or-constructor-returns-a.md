---
status: todo
created: 2026-11-15
---
# Invoke `__add_trace__` when a function or constructor returns a new actor

Spec: notes/add-trace-on-return-2026-11-14.md

A class (or service) may declare a method `__add_trace__` in its interface. When a Brevity function or constructor returns an actor that did not exist when its body started, BV must invoke `__add_trace__` on that actor, passing the address of the returning scope. Where the actor was created doesn't matter (this body, a local subcall, a remote subcall); only that it is new since the body started. BV decides whether to call it from the interface of the returned value's type: no declaration, no call.

Example, with HTML's element interface declaring `__add_trace__`:

```
use HTML::div
@template = -> <div>123</div>

{ op: '$new', to: 'HTML:div', from: ':template' }
{ re: ['#<HTML:div:123>'], ty: ['HTML:div'] }
{ op: [['#<:template>'], '__add_trace__'], to: 'HTML:div:123' }
```

Behaviour to cover, on js, rust and erlang:

- Function returning an element it built in return position: one call, its scope.
- Function returning an element it built earlier (`inner = <p>…</p>; return inner`): one call.
- Function returning the result of a local subcall that built it (`@component = -> @template()`): calls for template, then component, in that order.
- Same, where the subcall is to a remote actor: the caller still invokes it for its own scope.
- Function returning an actor it was handed (`@wrap = (el) -> el`): no call.
- Constructor: `@make = -> Counter(5)` with `Counter` declaring `__add_trace__`: one call on the new Counter actor, with make's scope.
- Returned type without `__add_trace__` in its interface: no call.
- Scope addresses in wire form: public bare, protected `~`, private `#`; a class scope is the class (`:Constructor`).

Out of scope:

- The receiver's semantics (tail append; a duplicate moves to the tail). That's the service's job, and a separate ticket for the HTML/browser runtime's `trace` attribute.
- `return <div>…</div>` inside a constructor block (currently drops the element on all three targets; its meaning is undecided).
- Cost (one call per returning level) and ordering against the caller's later messages. Accepted for now.
- How each target decides "did not exist when the body started" is the implementer's choice; the tests above define the behaviour.
