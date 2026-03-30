# View & Remote Actor Spawning — 2026-03-24

## Overview

An actor can request a platform service to spawn a child actor on its behalf.
The return value is a reference to that remote child, expressed as a path
derived from the wire protocol's `from` field. The actor then interacts with
the remote child through normal message passing.

Views (WebView windows) are the primary use case, but the mechanism is general
— any service that can spawn child actors works the same way.


## Brevity Source

```
uses WebViewer

ref view = WebViewer.create(path: "/views/my_view")

view ~ <
  @click = |e : Event| handle(e) .
  @resize = |w : Integer, h : Integer| layout(w, h) .
>

@start = { view.open() . }
@stop = { view.close() . }
@eval = |:js : Text| -> view.eval(js) : Text
```

- `uses WebViewer` — binds to a platform-provided service actor.
- `WebViewer.create(...)` — sends a `create` op to WebViewer, which spawns
  a child and returns a reference to it.
- `ref view` — the return is bound as a live actor reference. `ref` is
  required because effectful operations (open, close, eval) will be called.
- `view ~ < ... >` — binds event handlers for messages FROM the view.
- `@start`, `@stop`, `@eval` — public ops exposed to this actor's parent.


## Wire Protocol

### Spawning: outgoing request

```json
{
  "id": "123",
  "op": [{ "path": "/views/my_view" }, "create"],
  "bv-a": [{ "path": "Text" }],
  "to": "WebViewer"
}
```

### Spawning: reply

WebViewer spawns the child and replies. The reply comes FROM the new child's
address (relative to WebViewer):

```json
{
  "id": "123",
  "re": {},
  "bv-a": "self<WebView>",
  "from": "/views/my_view",
  "to": "path/back/to/caller"
}
```

As the reply traverses the tree back to the caller, each hop rewrites `from`
to prepend its own segment. The caller receives:

```json
{
  "id": "123",
  "re": {},
  "bv-a": "self<WebView>",
  "from": "WebViewer/views/my_view"
}
```

### bv-a: "self<WebView>"

- `self` — indicates the return value IS the sender. The meaningful content
  is the `from` address, not the `re` payload.
- `<WebView>` — the interface type of the remote actor. The caller's type
  system can enforce that the bound ref has `open`, `close`, `eval`, etc.

The `re: {}` payload is currently an empty structure. It could carry initial
state (e.g. `{ "status": "created" }`) in the future. The `bv-a` would then
combine both: data field types plus the self-reference marker.


### Calling the remote actor

Once the runtime binds `from` as the address for `ref view`, method calls
become normal messages:

```json
{ "id": "124", "op": "open", "to": "WebViewer/views/my_view" }
```

```json
{ "id": "125", "op": [{ "js": "document.title" }, "eval"],
  "bv-a": [{ "js": "Text" }],
  "to": "WebViewer/views/my_view" }
```

WebViewer receives these (it owns the path prefix) and routes to the
correct child.


### Events from the remote actor (via ~ binding)

The view sends events back to the caller through the same channel:

```json
{
  "id": "200",
  "op": [{ "target": "button1" }, "click"],
  "from": "WebViewer/views/my_view"
}
```

The `~ < ... >` binding on the caller side routes these to the declared
event handlers. The `from` field identifies which bound actor the event
came from.


## Path Mechanics (CAM)

No actor knows its own absolute address. Addresses are always relative to
the receiver's perspective.

- WebViewer spawns child at its local path `/views/my_view`
- WebViewer sets `from: "/views/my_view"` on the reply (relative to itself)
- Each hop on the return path prepends its segment to `from`
- Caller sees `from: "WebViewer/views/my_view"` (relative to caller)

This is the same mechanism that already exists for all CAM message routing.
Remote actor spawning doesn't require new routing infrastructure — it just
uses `from` to communicate the new child's address.


## Relationship to `uses`

`uses /services/auth as Auth` wires up a static path at declaration time.
`ref view = WebViewer.create(...)` wires up a dynamic path at runtime.
Same mechanism, different lifecycle:

- `uses` — path known at compile time, bound at actor startup
- Remote spawn — path returned at runtime, bound when reply arrives

Both produce a ref to a remote actor. Both use the same message-passing
interface for all subsequent interaction.


## Relationship to Constructors

Local constructors (`T = <x : Integer>`) create an actor in the current
process. The actor lives here.

Remote spawns (`WebViewer.create(...)`) ask a service to create an actor
elsewhere. The actor lives there. What comes back is a path, not an instance.

In both cases, the caller gets a ref it can send messages to. The difference
is transport — local actors use in-process dispatch, remote actors use
wire-protocol routing. The Brevity source looks the same either way.


## Open Questions

1. **Combined bv-a**: When the reply carries both data fields and a self
   reference, what does the bv-a look like?
   Current best: `"self<WebView>"`. May need expansion for
   `{ "status": "Text", "self": "WebView" }` or similar.

2. **Lifecycle**: What happens when the caller drops the ref? Should it
   send a `close` or `dispose` message to the remote actor? Or does the
   platform service (WebViewer) manage child lifecycle independently?

3. **Error handling**: What if `create` fails? The reply would need an
   `ex` field instead of `re`. How does `ref view = ...` handle a failed
   spawn?

4. **Multiple views**: Can you spawn multiple views from the same path?
   Presumably yes — each `create` call gets a unique child path.
   ```
   ref v1 = WebViewer.create(path: "/views/my_view")
   ref v2 = WebViewer.create(path: "/views/my_view")
   // v1 and v2 are different actors at different paths
   ```

5. **Event handler binding timing**: Does `view ~ < ... >` need to happen
   before `view.open()`? Or can event handlers be bound after the view
   is already open? Probably should work either way — the binding is
   on the caller side, not the view side.

6. **View-specific API**: `open()`, `close()`, `eval()` are WebView
   operations. Are these standardized in the WebViewer service interface,
   or does each platform define its own? Likely platform-specific behind
   a common interface contract.
