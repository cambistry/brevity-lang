---
status: wont-do
created: 2026-04-19
---
# subscribe keyword

Types can declare their own describe function.

It can take parameters or not, which would be provided with the subscription by the subscriber.

A subscription re fires immediately in response to the subscription, and then fires anytime that the function closure reevaluates, according to its subscriptions.

```
C = <> {
  @val *Text = ""
  subscribe = |before Text, after Text| { before + @val + after } : Text
}
...
c = C()
c.subscribe("[", "]") |value Text| { ... do something ... }
```
