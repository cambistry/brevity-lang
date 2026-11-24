---
status: inbox
created: 2026-04-10
---
# subscription / emit

We need a general language pattern for service subscription. This can be the same whether it is a remote service, a spawned remote instance, or a local instance. For simplicity, let’s consider the last case first:

```
publisher = P()
subscriber = <> { on publisher.event_op |params| { action }}
```

Under the hood, `on` sends a subscription request to publisher for the op “event_op”.

What is missing now is a declaration of the shape of this incoming event. This needs to appear in the service interface.

```
{
  emits notification: (Text) -> .
  emits edition: (:html Text) -> (:ack Boolean)
}
```
