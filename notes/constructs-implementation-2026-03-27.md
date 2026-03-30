# `constructs` — Implementation Plan

## What we're building

A `constructs` statement declares a relationship with a remote factory
service. Calling the factory creates a remote instance. The caller wraps
that instance in a local proxy actor that:

1. Delegates outbound calls to the remote instance
2. Handles inbound events from the remote instance via `on`
3. Can hold its own state and logic

## Syntax

### Full form

```
constructs WebViews(path: Text) as WebView

WebView = <view> {
  @open = { view.open() . }
  @close = { view.close() . }
  @eval = { result : Text = view.eval(); :result }
  on view.event |e : Text| { handle(e) . }
}

view = WebViews(path: "/panel")
view.open()
```

### Condensed form

```
constructs WebViews(path: Text) as <view> {
  @open = { view.open() . }
  @eval = { result : Text = view.eval(); :result }
  on view.event |e : Text| { handle(e) . }
}

view = WebViews(path: "/panel")
```

## What already works

We have working infrastructure for most of this:

### `uses` with inline manifest and constructor params
```
uses WebView(path: Text) {
  open: () -> (Text)
  close: () -> .
}
```
Parser handles constructor params on `uses`. Validation checks args
against the declared signature. The `::new` wire message is emitted
and instance address is captured from the reply's `from` field.

### Instance method routing
After `::new` reply, `view.open()` routes to the returned address
(`WebViews/42`). This works across JS, Erlang, and Rust.

### Wrapped child constructors
`<view>` as a constructor param — passing an actor reference into
another actor's constructor. The wrapper can call the wrapped
child's public methods. Works on JS and Erlang.

### `emit` and `on`
Emitters declare `emit fire() -> .` and invoke via `fire()`.
Subscribers declare `on firer.fire { ... }`. The subscription
wiring happens at construction time. Works on JS and Erlang.

## What's new

### The `constructs` keyword

`constructs WebViews(path: Text) as WebView` does three things:

1. Declares `WebViews` as a wire address (implies `uses WebViews`)
2. Declares the constructor signature: `(path: Text)`
3. Declares that `WebViews(...)` returns a `WebView` instance

### The proxy as a constructor type

`WebView = <view> { ... }` is a constructor where `<view>` binds the
remote instance. This is the same `<param>` constructor syntax we
already have. The difference: `view` is not a local actor passed in —
it's a remote reference obtained from the `::new` reply.

When someone writes `view = WebViews(path: "/panel")`:
1. `::new` is sent to `WebViews` with `{path: "/panel"}`
2. Reply arrives with `from: "WebViews/42"`
3. A `WebView` proxy is constructed with `view` bound to address
   `"WebViews/42"`
4. `on view.event` handlers subscribe to inbound messages from
   that address

### Inbound events via `on`

```
on view.event |e : Text| { handle(e) . }
```

This is the same `on` syntax used for local emit subscriptions.
The difference: the source is a remote actor, not a local one.

On the wire, the remote sends:
```json
{
  "op": [{"data": "..."}, "event"],
  "from": "WebViews/42"
}
```

The proxy receives this through its binding (stdin/stdout or
in-memory). The dispatch matches `op === "event"` and
`from === remote_address`, runs the `on` handler.

### ID elision for fire-and-forget

When the compiler sees a call whose result is unused:
```
view.open() .
```
The outgoing message omits the `id` field:
```json
{ "op": "@open", "to": "WebViews/42", "from": "my-address" }
```
No `id` means no response expected.

## Implementation steps

### Step 1: Parser — `constructs` keyword

Add `constructs` to the lexer as a keyword. Parse:
```
constructs FactoryName(params) as TypeName
```
and condensed:
```
constructs FactoryName(params) as <view> { body }
```

Produce a `ConstructsDecl` AST node:
```js
{
  type: 'ConstructsDecl',
  factory: 'WebViews',
  constructorParams: [...],  // (path: Text)
  proxyName: 'WebView',      // or null for condensed
  proxyParam: 'view',        // the <view> binding name
  proxyBody: [...]            // inline body for condensed form
}
```

### Step 2: Wire up construction

When `view = WebViews(path: "/panel")` is encountered:
- Emit `::new` to `WebViews` (already works via `uses` machinery)
- Capture instance address from reply `from` field (already works)
- Construct the proxy `WebView` with `view` bound to the address

For the full form, `WebView` is a named constructor defined
separately. For the condensed form, the proxy is anonymous and
defined inline.

### Step 3: Outbound calls from proxy

`view.open()` inside the proxy sends to the stored remote address.
This already works — the wrapped child `<view>` pattern stores the
address and `view.open()` routes there.

For remote instances specifically, calls go over the wire (not
through local dispatch). The codegen needs to detect that `view`
is a remote reference and use `#send` (JS) or `io:format` (Erlang)
instead of `child_dispatch`.

### Step 4: Inbound events via `on`

`on view.event |e| { ... }` in the proxy registers a handler for
messages arriving from the remote address with op `event`.

On the wire, the remote sends to the proxy's address. The proxy's
`receive` method gets the message and dispatches it.

The `on` handler matches: `op === "event" AND from === view_address`.
This is different from local `on` which matches `from === "__emit"`.
For remote sources, the `from` is the actual remote address.

### Step 5: Subscription — `::bind`

When the proxy has `on view.event { ... }`, construction must tell
the remote instance to route `event` emissions to this proxy.

Option A: Implicit — the `::new` `from` field already gives the
remote the proxy's address. The remote routes all emissions there
without a separate bind step.

Option B: Explicit — send a `::bind` message after `::new`:
```json
{ "op": ["event", "::bind"], "to": "WebViews/42", "from": "my-addr" }
```

Option A is simpler and sufficient if the remote routes all events
to its creator. Option B is needed if the proxy wants selective
subscription.

Start with Option A. Add `::bind` later if needed.

### Step 6: Validation

- Constructor params checked against `constructs` signature
- Proxy `view.X()` calls — no validation without manifest (trusted)
- `on view.X` handlers — no validation without manifest (trusted)
- Future: add instance manifest to `constructs` for full validation

## Wire protocol summary

### Construction
```
→ { id: "1", op: [{"path": "/panel"}, "::new"], to: "WebViews", from: "my-addr" }
← { id: "1", re: {}, bv-a: "self", to: "my-addr", from: "WebViews/42" }
```

### Outbound call (with response)
```
→ { id: "2", op: "@eval", to: "WebViews/42", from: "my-addr" }
← { id: "2", re: {"result": "..."}, to: "my-addr", from: "WebViews/42" }
```

### Outbound call (fire-and-forget)
```
→ { op: "@open", to: "WebViews/42", from: "my-addr" }
```

### Inbound event
```
← { op: [{"data": "..."}, "event"], from: "WebViews/42" }
```

### Inbound event with response
```
← { id: "3", op: [{"data": "..."}, "status"], from: "WebViews/42" }
→ { id: "3", re: {"status": "ok"}, to: "WebViews/42" }
```

## Relationship to existing features

| Feature | What it does | Status |
|---------|-------------|--------|
| `uses Name { manifest }` | Stateless service calls | Done |
| `uses Name(params) { manifest }` | Constructor + instance methods | Done |
| `<param>` constructor | Wrap a child actor | Done |
| `emit` / `on` | Local event pub/sub | Done |
| `constructs Name(params) as Type` | Remote factory + proxy | **This epic** |
| `on view.event` for remote | Inbound events from remote | **This epic** |
| `::bind` protocol | Selective subscription | Future |
| Instance manifest validation | Type-check proxy calls | Future |

## Test strategy

Drive from `keywords/constructs.test.js`. Tests exercise:

1. **Parsing**: `constructs` declaration compiles (full + condensed)
2. **Construction**: `::new` emitted with correct args
3. **Address capture**: reply `from` becomes the instance address
4. **Outbound calls**: proxy methods route to instance address
5. **Inbound events**: mock remote event, verify `on` handler runs
6. **Full roundtrip**: construct, call, receive event, respond

All from the caller's side — the remote factory is mocked via
test messages, not implemented.
