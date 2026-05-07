# Remote Instances

LLM orientation: this file describes the tested caller-side protocol for remote
constructors.

## Canonical Form

```brevity
*(
  "WebView": (WebView) *(:path Text) -> {
    open: () -> .
    getTitle: () -> (:title Text)
  }
)
=

view = WebView!(path: "/my_view")

@open = { view.open() . }
```

## Wire Behavior

Initialization emits a construction message:

```json
{ "op": [{ "path": "/my_view" }, "#new"], "to": "WebView" }
```

The constructor reply supplies the instance address:

```json
{ "re": "#<WebView/1>", "bv-a": "#<WebView>", "from": "WebView" }
```

After that, `view.open()` routes to the returned address:

```json
{ "op": "@open", "to": "WebView/1" }
```

## Tested Cases

- A single remote instance receives later method calls.
- Sequential calls route to the same returned address.
- Multiple `Name!(...)` declarations produce independent instance addresses.
- Named constructor args appear in the `#new` payload.

## LLM Rules

- Use `Name!(...)` for remote instance construction.
- Use `#new` for the wire-level construction op.
- Use `#<Type/id>` as the returned instance address token in protocol examples.
- Do not describe the returned instance as a local object; it remains an actor
  address reached through messages.
