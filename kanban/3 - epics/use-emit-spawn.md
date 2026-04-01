We've got a syntax for injection of service dependencies:

<
  "/path": Service *
> {
  Service.get(...)
}

But... what if we aren't sending outgoing messages/requests, but listening for incoming messages?

First insight: public functions are "listeners" on parent. Sort of like there is an implicit constructor param:

<
  @: *
>

The syntax @fn is, I suppose, sugar for something like:

`on parent.fn`

Let's think about this from the parent perspective. A parent would need to `spawn` a child.

`child = spawn(path: "/script")`

[What exists at "/script" is a different topic.]

Sending messages to `child` is a normal function call, `child.fn()`, which sends the op "fn" to the child actor. But how does parent capture events from the child? If we go with the syntax from the `emit` feature, then something like:

`on child.fn = {...}`

But gotta say that `on` seems oddly placed. Feels more like it should be:

`child.on "fn" |args| {...}`

And the `emit` syntax should work the same:

<inner *> {
  inner.on "event" {...}
}

From the emitter's side:

<> {
  @go = { parent.event(...) }
}

Shorthand maybe:

<> {
  @go = { ^event(...) }
}

So maybe the listener uses that syntax too?

<inner *> {
  inner^event {...} // or inner.^event ?
}

Dunno. Not sure the caret is earning its keep.

----

BUT... a child doesn't just holler at a service it wants. These are wired up with dependency injection.

child: `<Remote: *> { Remote.call() }`
parent: `child = spawn_child_process("/script", Remote: remote)`

where `remote is an actor/service declared in the parent, or a sub-dependency or other sibling.

---

I wonder if we could deprecate `emit` using this shape:

A = <> {
  subscriber (* | null) = null
  @subscribe = |s *| { subscriber <- s }
  @fire = { if subscriber { subscriber.shoot() } }
}

B = <shooter *A> {
  shooter.subscribe(self)
  shooter.on("shoot") {...}
}

---

Back to parent/child:

child: `<Remote: *> { Remote.call() }`
parent: `child = spawn_child_process("/script", Remote: remote)`

What is interesting is this: what is being filtered for, under the hood, is the "to" field. The child gets the `Remote` injection and thereby knows to send to "to": "Remote". The parent `spawn` wires up this connection to the local or remote service that it designates for the call.

This is getting close to making sense. What is missing is "to"-based child delegation. How does an actor route incoming messages with a "to" field? Quick answer: however it wants to. But we have not actually exposed a mechanism to work with the raw-"to".

<> {
  @local = {} // no "to", or empty
  child = spawn(path: "/script")
  scope |to: "/child", ...rest| { send(child, rest) }
}
