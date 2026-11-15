# Opre subops — 2026-11-15

Status: **proposal.** Depends on [op args always bracketed](op-args-always-bracketed-2026-11-15.md)
and [op chains](opre-op-chains-2026-11-15.md).

## The problem

A chain sends each step to the previous result. Writing to a child of the new actor doesn't fit:

```brevity
a = Class()
a.val <- 100
```

Spelled out today, that's two messages and a round trip:

```js
{ id: "1", op: "$new", to: "Class" }
{ id: "1", re: "#<Class:1>", ty: "Class", from: "Class" }
{ op: [[100], "$set"], to: "Class:1:val", ty: [["Integer"]] }
```

`["$new", [100], "$set"]` would send `$set` to the actor, not to its `val`. And the program
needs the new actor's address back, not the child's.

## The form

An object in `op` is a subop: a message fragment run against the current subject.

```js
{ id: "1", op: ["$new", { op: [[100], "$set"], to: ":val", ty: [["Integer"]] }], to: "Class" }
{ id: "1", re: "#<Class:1>", ty: "Class", from: "Class" }
```

- **`to` is required** and is relative to the current subject: `:val` is the subject's `val`.
- **Inside the subop, the subject is its `to`.** Its `op` is a full op sequence, so it may chain
  and may contain subops.
- **After the subop, the subject returns to the containing subject.** A subop doesn't change the
  chain's subject or result. A subop as the last element makes the chain's result the subject,
  as above: the reply is the new actor's address.
- **A subop carries its own `ty`.** The containing `ty` skips subops as it skips op names.
  Since the subop already carries message fields (`to`, maybe `id`, maybe `from`), `ty` is one
  more; a subject running the subop sends it on nearly as written.

```js
{ op: ["$new", [{ radius: 20 }], "resize!", { op: [["#aaa"], "$set"], to: ":color", ty: [["Text"]] }],
  to: "Circle",
  ty: [[{ radius: "Integer" }]] }
```

## Replies

- **No `id` on the subop: silent.** Its result is discarded. This is the usual case.
- **An `id` on the subop:** its result goes to the original requester as its own `re` with that
  id. Never to the subject: the subject didn't ask, and has nowhere to return it.
- **The outer and inner `id`s are independent.** A message may have an `id` on a subop and none
  on the main op.

## Transactions

A subop is part of its chain's transaction: if it fails, the whole chain rolls back.

## Open questions

- **Multiple replies to one message:** a requester receiving several `re`s for one request
  (inner and outer ids), their order, and what a requester sees when a later step fails after an
  inner reply was sent, given rollback.
