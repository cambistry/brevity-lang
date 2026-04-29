# Remote Interop

LLM orientation: use this as the current guide for ordinary cross-actor calls.
The core point is that the source can read like a function call while still
lowering to explicit CAM message traffic.

## Canonical Dependency Form

```brevity
<
  "Remote": (Remote) {
    get: (:url Text) -> (:response Text)
  }
>
=

@call_remote
  =
  :url Text
  =
  :response Text = Remote.get(:url)
  -> :response
```

Expected behavior:

- incoming `@call_remote` receives `{ url }`
- actor emits outgoing `@get` to `Remote`
- host or remote actor replies with `re: { response: ... }`
- original caller receives the handler reply

## Silent Calls

Use `spawn` when calling a silent remote operation from a replying handler:

```brevity
<
  "Store": (Store) {
    notify: (:msg Text) -> .
  }
>
=

@send_notify
  =
  :msg Text
  =
  spawn Store.notify(:msg)
  -> ack: "ok"
```

The outgoing message is still sent to `Store`, but the handler does not wait for
a value from `notify`.

## Tested Patterns

- Two-actor request/reply.
- Silent remote public functions.
- Three-actor chains where each actor transforms and forwards a result.
- Callback flow where a worker calls back into the original boss actor.
- External sends in `external_send.test.js` using both fire-only and receive
  forms.

## LLM Rules

- Use `:name Type` for named parameters in current examples.
- Use `-> :name` or `-> field: expr` for replies.
- Include `bv-a` when describing raw wire input/output expectations.
- Treat `Remote.get(...)` as syntax for a typed actor message, not a local method
  call.
