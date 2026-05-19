# Remote Actors

LLM orientation: this file describes the caller-side wire protocol when a
remote actor is constructed — the `#new` message sent to the dependency and
routing of the returned address.

## Canonical Form

```brevity
*(
  "WebView": (WebView) *(:path Text) -> {
    open: () -> .
    getTitle: () -> (:title Text)
  }
)
=

view = *WebView(path: "/my_view")

@open = { view.open() . }
```

## Wire Behavior

Construction sends a `#new` message:

```json
{ "op": [{ "path": "/my_view" }, "#new"], "to": "WebView" }
```

The reply supplies the actor address:

```json
{ "re": "#<WebView/1>", "bv-a": "#<WebView>", "from": "WebView" }
```

After that, `view.open()` routes to the returned address:

```json
{ "op": "@open", "to": "WebView/1" }
```

## Tested Cases

- A single remote actor receives later method calls.
- Sequential calls route to the same returned address.
- Multiple `*Name(...)` declarations produce independent actor addresses.
- Named class args appear in the `#new` payload.

## LLM Rules

- Use `*Name(...)` for remote actor construction.
- Use `#new` for the wire-level construction op.
- Use `#<Type/id>` as the returned actor address token in protocol examples.
- Do not describe the returned actor as a local value; it remains an actor
  address reached through messages.
