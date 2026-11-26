# Function Subscriptions

LLM orientation: function subscriptions use the same repeated-reply idea as
reactive cells. A subscriber receives an initial value and later values when
captured cells change.

## Local Function Subscription

```brevity
body *Integer = 0

@pub = { body * 2 }
#priv = { body + 1 }

lastPub *Integer = 0
lastPriv *Integer = 0

@doSubs. = {
  sub @pub, (v) { lastPub <- v } ;
  sub #priv, (v) { lastPriv <- v }
}
```

Changing `body` re-evaluates subscribers.

## Parameterized Subscription

```brevity
#parameterized = (p: Integer) { body + p }

@doSub. = {
  sub #parameterized(p: 100), (v) { last <- v }
}
```

Each subscription stores its own argument tuple. On replay, the function uses
the subscriber's original args.

## Child Actor Subscription

```brevity
C = * {
  @body *Integer = 0
  @pub = { @body * 2 }
}

c = C()
last *Integer = 0

@doPubSub. = { sub c.pub, (v) { last <- v } }
@bumpC. = (n: Integer) { c.body <- n }
```

## Remote Subscription Wire Shape

Subscribing to a remote function posts `$sub` to a function-specific
address:

```text
to: "Pub:pub"
op: "$sub"
```

Parameterized subscribe carries args:

```text
to: "Pub:pub_w_params"
op: [[{ p: 100 }], "$sub"]
```

Later `re` messages with the same id update subscriber state.

## LLM Rules

- Use `sub subject, (v) { ... }` for a subscription; its args follow the subject: `sub c.pub(p: 1), (v) { … }`.
- Keep subscription handlers silent.
- Store subscription results in `*Type` cells.
- For remote subscription examples, include the `#<Alias:@member>` address shape.
