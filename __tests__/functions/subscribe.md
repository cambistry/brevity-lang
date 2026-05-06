# Function Subscriptions

LLM orientation: function subscriptions use the same repeated-reply idea as
reactive cells. A subscriber receives an initial value and later values when
captured refs change.

## Local Function Subscription

```brevity
body Integer! = 0

@pub = { body * 2 }
#priv = { body + 1 }

lastPub Integer! = 0
lastPriv Integer! = 0

@doSubs = {
  @pub.subscribe (v) { lastPub <- v } ;
  #priv.subscribe (v) { lastPriv <- v } ;
  .
}
```

Changing `body` re-evaluates subscribers.

## Parameterized Subscription

```brevity
#parameterized = (:p Integer) { body + p }

@doSub = {
  #parameterized.subscribe(p: 100) (v) { last <- v } ;
  .
}
```

Each subscription stores its own argument tuple. On replay, the function uses
the subscriber's original args.

## Child Actor Subscription

```brevity
C = <> {
  @body Integer! = 0
  @pub = { @body * 2 }
}

c = C()
last Integer! = 0

@doPubSub = { c.pub.subscribe (v) { last <- v } ; . }
@bumpC = (:n Integer) { c.body <- n . }
```

## Remote Subscription Wire Shape

Subscribing to a remote function posts `@subscribe` to a function-specific
address:

```text
to: "#<Pub @pub>"
op: "@subscribe"
```

Parameterized subscribe carries args:

```text
to: "#<Pub @pub_w_params>"
op: [{ p: 100 }, "@subscribe"]
```

Later `re` messages with the same id update subscriber state.

## LLM Rules

- Use `.subscribe (v) { ... } ;` for local subscription blocks.
- Keep subscription handlers silent.
- Store subscription results in `Type!` refs.
- For remote subscription examples, include the `#<Alias @member>` address shape.
