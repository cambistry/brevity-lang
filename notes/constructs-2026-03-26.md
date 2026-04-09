# `constructs` — Remote Instance Wrapping

## Overview

`constructs` declares a relationship with a factory service that produces
remote instances. Unlike `uses` (which describes a service you call),
`constructs` describes a service that creates a new process, which you then
wrap in a local proxy actor.

The proxy actor is the interface boundary: it handles outbound calls to
the remote instance AND inbound events from it.

## Syntax

### Full form

```
constructs WebViews(path: Text) as WebView

WebView = <view> {
  @open = { view.open() . }
  @close = { view.close() . }
  @eval = { result : Text = view.eval(); :result }
  view.event = |e| { process(e) . }
}
```

Three declarations:
1. `constructs WebViews(path: Text) as WebView` — factory declaration
2. `WebView = <view> { ... }` — proxy actor definition
3. Usage: `view = WebViews(path: "/my_view")` creates via the factory,
   returns a `WebView` proxy

### Condensed form

```
constructs WebViews(path: Text) as <view> {
  @open = { view.open() . }
  @close = { view.close() . }
  @eval = { result : Text = view.eval(); :result }
  view.event = |e| { process(e) . }
}
```

The proxy definition is inlined into the `constructs` declaration.
Equivalent to the full form but more concise for simple cases.

### Aliasing

`constructs` implies a `uses` relationship with the factory name.
Explicit aliasing if needed:

```
uses "/webviews" as WebViews
constructs WebViews(path: Text) as WebView
```

Without aliasing, the factory name IS the wire address.

## What `<view>` means

The constructor param `<view>` binds the remote instance reference.
Inside the proxy body:

- `view.open()` — sends an outbound message to the remote instance
- `view.event = |e| { ... }` — declares a handler for inbound events
  from the remote instance

The `view` param is NOT a value — it's the communication channel to
the specific remote instance returned by `::new`.

## Wire Protocol

### Construction

Request:
```json
{
  "id": "<req-id>",
  "op": [{"path": "/my_view"}, "::new"],
  "to": "WebViews",
  "from": "instance-id-123"
}
```

The `from` field is the caller's address. This immediately establishes
the bidirectional communication channel — the remote instance knows
where to send events.

Response:
```json
{
  "id": "<req-id>",
  "re": {},
  "bv-a": "self",
  "to": "instance-id-123",
  "from": "WebViews/42"
}
```

`from: "WebViews/42"` is the new instance's address. All subsequent
outbound calls route there. `bv-a: "self"` indicates this is the
instance itself responding.

### Outbound instance calls

```json
{
  "id": "<req-id>",
  "op": "@open",
  "to": "WebViews/42",
  "from": "instance-id-123"
}
```

When the return value is unused (call followed by `.`), the `id` field
is omitted — signaling fire-and-forget:

```json
{
  "op": "@open",
  "to": "WebViews/42",
  "from": "instance-id-123"
}
```

### Inbound events (remote → proxy)

```json
{
  "op": [{"data": "..."}, "self.event"],
  "from": "WebViews/42"
}
```

The `self.` prefix indicates this is a privileged call into the proxy's
private handler space. The remote instance can fire events because it
has the proxy's address from the `::new` exchange.

No necessary `id` on inbound events — they are fire-and-forget notifications
(the remote doesn't wait for a reply). If the remote needs a reply,
an `id` is included and the proxy's handler returns via `->`.

## Inside the proxy

### Outbound methods

Public functions on the proxy (`@open`, `@close`, `@eval`) are the
consumer-facing API. They delegate to the remote instance:

```
@open = { view.open() . }
```

The proxy can transform, validate, or enrich the call. It's not just
a passthrough — it's a real actor with its own logic.

### Inbound event handlers

```
view.event = |e| { process(e) . }
```

This declares a handler that fires when the remote instance emits
`self.event`. The handler runs in the proxy's context — it has
access to the proxy's state, ref vars, and other handlers.

Syntactically, `view.event = |e| { ... }` is a handler declaration,
not a property assignment. The `view.` prefix scopes it to events
from that specific instance.

### State

The proxy is a full actor. It can have `ref` vars, local functions,
and its own state:

```
WebView = <view> {
  ref visible : Boolean = false
  @open = { view.open(); visible <- true . }
  @isVisible = -> :visible : Boolean
  view.event = |e| { handle(e) . }
}
```

## ID elision — fire-and-forget optimization

When the compiler determines that a return value is not used (the call
is followed by `.` or is a standalone expression with no assignment),
the outgoing message omits the `id` field. This signals to the receiver
that no response is expected.

This is a general rule, not specific to `constructs`:
- `Remote.ping() .` — no `id` (fire-and-forget)
- `:result = Remote.get()` — has `id` (waiting for response)
- `Remote.fire("event") .` — no `id`

The `.` after a call is already the language's signal for "I don't care
about the result." Making that also elide the `id` is a natural wire
optimization that falls from the language semantics.

## Relationship to `uses`

`uses` and `constructs` are complementary:

- `uses Remote { ... }` — I call a stateless service. No instance, no
  events. Request-response only.
- `constructs WebViews(...) as WebView` — I create instances of a
  stateful service. The instance has identity, can hold state, and can
  emit events back to me.

A `constructs` declaration implies `uses` for the factory endpoint.
The factory's only public function is `::new`.

## Open questions

### Interface for instance methods

The current implementation does not require an interface for the
remote instance's methods. The proxy calls `view.open()` without the
compiler knowing if `open` exists on the remote. This is a temporarily
privileged arrangement — the proxy author is trusted to know the remote's
interface.

Future: the `constructs` declaration could include an instance manifest:

```
constructs WebViews(path: Text) as WebView {
  open: () -> .
  close: () -> .
  eval: () -> (Text)
  emit event: (data: Text)
}
```

This would enable compile-time validation of proxy method calls against
the remote's actual interface.

### The `!` effectful marker

Calls that produce side effects could be marked with `!`:

```
@open! = { view.open!() . }
```

This is a separate design concern. The `!` signals to the reader (and
potentially the compiler) that the call has effects. It does not change
the wire protocol — the distinction between effectful and pure is a
language-level concept, not a wire-level one.

Deferred to a future pass.
