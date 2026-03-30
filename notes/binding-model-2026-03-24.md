# Binding Model: locals, refs, permits

Every named binding in Brevity sits on a two-axis grid:
**mutability** (local → ref → permit) and **visibility** (private → public).

## The six forms

```
x = 0              local.  child scopes can read.
@x = 0             illegal — only functions can be public.

ref x = 0          virtual actor.  child scopes can read/write.
                   passable (with &) as read-only.
ref @x = 0         + public read-only getter.

permit x = 0       like ref, but passable writable.
permit @x = 0      + public writable (external set/update).
```

## What each axis means

### Mutability

| Form     | Own scope | Child scopes | Passed via `&` |
|----------|-----------|--------------|----------------|
| `x`      | rebind    | read         | —              |
| `ref x`  | read/write| read/write   | read-only      |
| `permit x`| read/write| read/write  | read/write     |

A plain local is a lexical binding. Rebindable in its declaring scope,
visible as read-only to child scopes (lambdas, inner functions).
Not passable — it's not an actor, just a name.

A `ref` creates a virtual actor: it has state, and responds to
`set` (`<-`) and `update` (`<|`) messages. Within the declaring actor,
any scope can read and write it. When passed to another function with `&x`,
the recipient gets a **read-only** handle — they can observe but not mutate.

A `permit` is a ref with broader write authority. When passed with `&x`,
the recipient gets **read/write** access. This is the explicit opt-in
for sharing mutation across function boundaries.

### Visibility

The `@` modifier promotes a binding to the actor's public interface —
it becomes addressable by external actors via messaging.

- `@` on a function: the function becomes a message handler.
- `@` on a ref: a read-only getter is generated. External actors can
  query the current value by sending `@x`.
- `@` on a permit: read-write access is generated. External actors can
  query (`@x`) and mutate (`::set`, `::update`).
- `@` on a plain local: **illegal**. There's no handler to generate —
  a bare value has no message interface.

## The trust gradient

```
         local          ref            permit
        ┌──────────┐  ┌──────────┐   ┌──────────┐
private │ read     │  │ read     │   │ read     │
        │          │  │ &: r/o   │   │ &: r/w   │
        └──────────┘  └──────────┘   └──────────┘
                      ┌──────────┐   ┌──────────┐
public                │ @: read  │   │ @: r/w   │
                      └──────────┘   └──────────┘
```

Each step to the right widens who can write.
Each step down widens who can see.
Both axes require explicit opt-in — the default is narrow.

## Design rationale

The same trust decision applies at every level of the actor tree:

- Within an actor: `ref` vs `permit` controls whether passed references
  carry write authority.
- At the actor boundary: `@` controls whether external actors can
  interact at all.
- The combination (`ref @x` vs `permit @x`) determines both.

There is no way to accidentally expose mutation. You must say `permit`,
and you must say `@`. Two separate, visible decisions.
