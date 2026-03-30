# Emit & Subscribe — Event Pattern Design

## The Problem

Actors need to notify other actors when things happen. The notification
pattern requires two sides:

1. The emitter: "this happened"
2. The receiver: "I care about that"

Neither side should need to know the other's full interface. The emitter
doesn't know who's listening. The receiver just declares interest.

## The Mechanism

Two language features, working together:

### `emit` — send to subscribers

```
emit fire(e)
```

`emit` packages the call as an op and sends it to whoever has subscribed.
It is NOT a function call — there is no local function `fire`. `emit`
creates a wire message and routes it to registered recipients.

- No `id` — fire-and-forget
- No explicit `to` — the runtime knows the subscribers
- Zero subscribers is fine — the message goes nowhere, no error
- Multiple subscribers is fine — each gets a copy

Can also emit set/update operations:

```
emit <- (new_val)
emit <| (update_params)
```

No dot. `emit fire()` not `emit.fire()`. The lack of dot is honest —
there may be zero, one, or many recipients. A dot implies a specific
target.

### `f.fire = { ... }` — subscribe and handle

```
f.fire = { count <- count + 1 . }
```

This does two things in one declaration:

1. **Subscribes**: sends a bind message to `f` saying "route your `fire`
   events to my address"
2. **Handles**: registers a local handler scoped to `fire` ops arriving
   from `f`'s address

The `=` IS the subscription. No separate subscribe call needed.

The handler is private — it's not a public `@` function. It only fires
when the matching op arrives from the specific source (`f`).

## Local Example

```
Firer = <> {
  @fire = { emit fire() }
}

Counter = <firer> {
  ref count : Integer = 0
  @count = -> :count : Integer
  firer.fire = { count <- count + 1 . }
}

f = Firer()
c = Counter(f)
f.fire()
c.count()   // 1
```

Flow:

1. `Counter(f)` — Counter is constructed with a reference to Firer
2. `firer.fire = { ... }` — during Counter's init, this subscribes
   Counter to Firer's `fire` events
3. `f.fire()` — external caller triggers Firer's `@fire` handler
4. `emit fire()` — Firer sends `fire` op to all subscribers (Counter)
5. Counter's `firer.fire` handler runs, increments count
6. `c.count()` returns 1

## Remote Example

```
constructs WebViews(path: Text) as <view> {
  @open = { view.open() . }
  @eval = { result : Text = view.eval(); :result }
  view.event = |e| { process(e) . }
}
```

On the remote side:

```
View = <> {
  @event! = |e : Event| { emit event(e) }
}
```

Flow:

1. `WebViews(path: "/panel")` sends `::new` to the factory. The `from`
   field carries the proxy's address.
2. The factory creates a View instance. The View knows the proxy's
   address from the `::new` message.
3. `view.event = |e| { ... }` — the proxy subscribes to the View's
   `event` emissions. Under the hood, this sends a bind message to
   the View instance (or the subscription is implicit from `::new`).
4. When a UI event occurs, the View runs `@event!` which does
   `emit event(e)` — sending to the proxy.
5. The proxy's `view.event` handler processes the event locally.

## Wire Protocol

### emit message (emitter → subscriber)

```json
{
  "op": [{"data": "..."}, "event"],
  "from": "<emitter-address>"
}
```

No `id` (fire-and-forget). No `to` in the emitter's code — the runtime
resolves subscribers.

### subscription bind (subscriber → emitter)

```json
{
  "op": ["::bind", "fire"],
  "to": "<emitter-address>",
  "from": "<subscriber-address>"
}
```

Protocol-level message, like `::new`. Tells the emitter to route `fire`
events to this address. The emitter stores the address internally.

For remote instances created via `::new`, the `from` field in the
construction message may serve as an implicit bind — the instance
routes all emissions to its creator without a separate `::bind`.

## What `emit` is NOT

- Not a function call — there is no local function with that name
- Not `parent.fire()` — emit doesn't assume tree topology
- Not a broadcast — it goes to registered subscribers, not everyone
- Not blocking — no `id`, no response expected

## What `f.fire = { ... }` is NOT

- Not a method override — it doesn't change `f`'s behavior
- Not a property assignment — `f.fire` is not a value
- Not a public handler — it's private, scoped to source `f`

## Open Questions

### Explicit emit declarations

Should emitters declare what they can emit?

```
Firer = <> {
  emit fire(e : Event)    // declaration — no body
  @trigger = { emit fire(e) }
}
```

This would let the compiler validate `firer.fire = { ... }` against
the declared emit signature. Without it, the consumer is trusted to
get the shape right.

Deferred — useful for service manifests but not required for v1.

### Multiple subscribers

`emit` naturally supports multiple subscribers. Each `f.fire = { ... }`
from a different actor adds another recipient. The emitter sends to all.

```
f = Firer()
a = ListenerA(f)   // firer.fire = { ... } subscribes A
b = ListenerB(f)   // firer.fire = { ... } subscribes B
f.fire()           // both A and B receive it
```

### Unsubscribe

Not yet designed. Possibly `f.fire = null` or a `::unbind` protocol
message. Low priority — actors are typically bound for their lifetime.

### emit with return value

Can an emit expect a response?

```
emit status() -> (Text)
```

Probably not — emits are notifications. If you need a response, call
a function. The asymmetry is intentional: emit is one-way, calls are
request-response.
