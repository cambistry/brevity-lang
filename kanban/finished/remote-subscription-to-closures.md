---
created: 2026-04-19
---
# remote subscription to closures

```
{op: "subscribe@closure" ...}
```

In code this looks like:

```
c = C()
c.closure.subscribe |val Type| { ... }
```

which executes the lambda on each publish.
