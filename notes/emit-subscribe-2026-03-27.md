# Emit & Subscribe — Event Pattern Design

## The Problem

Actors need to notify other actors when things happen. The notification
pattern requires two sides:

1. The emitter: "this happened"
2. The receiver: "I care about that"

Neither side should need to know the other's full interface. The emitter
doesn't know who's listening. The receiver just declares interest.

## The Mechanism

Three language features, working together:

### `emit` declaration — define what an actor can emit

```
Firer = <> {
  emit fire(e : Event) -> (Text)
  @trigger = |e : Event| { result : Text = fire(e); result }
}
```

`emit fire(e : Event) -> (Text)` declares:
- This actor can emit `fire`
- The call signature: takes `(e : Event)`, returns `(Text)`
- Subscribers must provide a handler matching this signature

Once declared, `fire(e)` is callable inside the actor as a regular
function name. Under the hood it packages the call as an op and sends
it to all subscribers.

The return type matters: if the emit declaration has a return signature
(`-> (Text)`), the invocation includes a message `id` and waits for
a response. If the declaration is silent (`-> .`), no `id` is sent.

### `emit` — silent (no return)

```
emit event(e : Event) -> .

@on_click = |e : Event| { event(e) . }
```

No `id` sent. Fire-and-forget. The `.` in the invocation is redundant
with the declaration but reads clearly.

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

The compiler validates the handler against the emit declaration's
signature if available.

## Dotless `emit`

No dot. `emit fire()` not `emit.fire()`. `fire(e)` in invocation, not
`emit.fire(e)`. The lack of dot is honest — there may be zero, one, or
many recipients. A dot implies a specific target.

Can also emit set/update operations:

```
emit <- (new_val) -> .
emit <| (update_params) -> .
```

## Local Example

```
Firer = <> {
  emit fire() -> .
  @fire = { fire() }
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
   Counter to Firer's `fire` events and registers the handler
3. `f.fire()` — external caller triggers Firer's `@fire` handler
4. `fire()` — inside Firer, invokes the declared emit. Sends `fire`
   op to all subscribers (Counter)
5. Counter's `firer.fire` handler runs, increments count
6. `c.count()` returns 1

## Local Example — with return value

```
Checker = <> {
  emit check(n : Integer) -> (valid : Boolean)
  @validate = |n : Integer| {
    :valid = check(n)
    -> :valid
  }
}

Validator = <checker> {
  checker.check = |n : Integer| -> valid: (n > 0) as Boolean
}

c = Checker()
v = Validator(c)
c.validate(5)   // { valid: true }
```

Flow:

1. `check(n)` inside Checker sends `check` op WITH an `id` (because
   the emit declaration returns `(valid : Boolean)`)
2. Validator's handler runs, returns `valid: true`
3. The response routes back, `check(n)` resolves, `@validate` continues

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
  emit event(e : Event) -> .
  @event! = |e : Event| { event(e) }
}
```

Flow:

1. `WebViews(path: "/panel")` sends `::new` to the factory. The `from`
   field carries the proxy's address.
2. The factory creates a View instance. The View knows the proxy's
   address from the `::new` message.
3. `view.event = |e| { ... }` — the proxy subscribes to the View's
   `event` emissions. Under the hood, this sends a `::bind` message
   to the View instance (or the subscription is implicit from `::new`).
4. When a UI event occurs, the View runs `@event!` which calls
   `event(e)` — the declared emit. Sends to the proxy.
5. The proxy's `view.event` handler processes the event locally.

## Wire Protocol

### emit message (emitter → subscriber)

Silent emit (no return):
```json
{
  "op": [{"data": "..."}, "event"],
  "to": "<subscriber-address>",
  "from": "<emitter-address>"
}
```

No `id` — the emit declaration was `-> .`.

Emit with return:
```json
{
  "id": "<msg-id>",
  "op": [{"n": 5}, "check"],
  "to": "<subscriber-address>",
  "from": "<emitter-address>"
}
```

Has `id` — the emit declaration has a return type. Emitter waits for
response.

Note: the emitter's code has no explicit `to`. The runtime resolves
subscriber addresses and sends a message to each. On the wire, each
message has a concrete `to` address.

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

- Not a function call to a local function — it creates a wire message
- Not `parent.fire()` — emit doesn't assume tree topology
- Not a broadcast — it goes to registered subscribers, not everyone

## What `f.fire = { ... }` is NOT

- Not a method override — it doesn't change `f`'s behavior
- Not a property assignment — `f.fire` is not a value
- Not a public handler — it's private, scoped to source `f`

## Design Decisions

### Emit declarations are explicit

Emitters MUST declare their emits. This enables:
- Compile-time validation of subscriber handlers
- Service manifest generation (emits appear in the manifest)
- Clear documentation of what an actor produces

### Return value determines wire behavior

The emit declaration's return signature controls the wire:
- `-> .` — no `id`, fire-and-forget
- `-> (Type)` — `id` included, emitter waits for response

This is consistent with the general rule: if you're going to use the
result, send an `id`. If not, don't.

### `f.fire =` is subscription + handler

One declaration, two effects. No separate subscribe/listen call.
The syntax mirrors property declaration but means "handle events
from this source."

## Multiple Subscribers

`emit` naturally supports multiple subscribers. Each `f.fire = { ... }`
from a different actor adds another recipient. The emitter sends to all.

```
f = Firer()
a = ListenerA(f)   // firer.fire = { ... } subscribes A
b = ListenerB(f)   // firer.fire = { ... } subscribes B
f.fire()           // both A and B receive it
```

For emits with return values, the emitter receives responses from ALL
subscribers. How these are aggregated is an open question — first
response wins? Collect all? Probably: first response, ignore the rest.

## Open Questions

### Unsubscribe

Not yet designed. Possibly `f.fire = null` or a `::unbind` protocol
message. Low priority — actors are typically bound for their lifetime.

### Emit in service manifests

The `emit` declarations should appear in the service manifest alongside
public functions:

```
{
  validate: (Integer) -> (valid: Boolean)
  emit check: (Integer) -> (valid: Boolean)
  emit event: (Event) -> .
}
```

The `emit` prefix distinguishes inbound callbacks from outbound methods.
