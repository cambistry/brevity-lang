# `constructs`

`constructs` declares a factory actor that creates instances of another actor
shape.

It is one of the language features that most clearly shows Brevity thinking in
terms of actor systems rather than isolated objects.

## The core idea

A `constructs` declaration ties three things together:

- a factory actor
- the constructor arguments used to request a new instance
- the local actor shape used to talk to the resulting instance

```brevity
constructs WebViews(path: Text) as WebView
```

This says that `WebViews` is a constructor-like actor. Sending it a `new`
message with `path: Text` produces something that should be treated locally as a
`WebView`.

## Why this matters

Many systems have resources that are not just values and not just static
services:

- windows
- views
- sockets
- database sessions
- subprocess-like handles

Those things are often created dynamically and then interacted with as distinct
instances. `constructs` gives Brevity a language-level way to represent that
pattern.

## A constructed instance is still an actor reference

Once construction succeeds, the resulting handle is used like an actor
reference:

```brevity
constructs WebViews(path: Text) as WebView

WebView = <view> {
  @open = { view.open() . }
}

v *WebView = WebViews(path: "/panel")
```

The constructed value is not treated as a magical resource object outside the
actor model. It becomes something that can receive messages and participate in
`on` handlers like the rest of the system.

That continuity is one of the main reasons the feature is interesting.

## Construction is a protocol step

Under the hood, the tests show that construction emits a `new` message and
waits for a reply that identifies the new instance.

That means `constructs` is not merely a compile-time alias for calling a
constructor locally. It is a protocol for creating remote or external instances
and then rebinding subsequent method calls to the created address.

This is especially useful when the constructed thing lives outside the current
actor's process or runtime.

## `constructs` and `on`

One of the most powerful aspects of `constructs` is that the resulting instance
can participate in event-style interaction:

```brevity
on view.click { count <- count + 1 . }
```

That means the constructed instance is not only callable. It can also become a
source of incoming events routed back into the actor's own logic.

This makes `constructs` feel much richer than a plain factory helper. It is a
way of bringing externally created, instance-shaped behavior into Brevity's
actor and event model.

## Why `constructs` exists in the language

Without a feature like this, a project would end up faking it with a mixture of:

- special remote factory conventions
- raw `new` messages
- manually tracked instance addresses
- custom wrapper code around each new kind of resource

`constructs` raises that pattern into the language so the structure becomes
explicit and reusable.

It says that dynamic instance creation is not a one-off transport trick. It is
a recurring kind of relationship between actors.
