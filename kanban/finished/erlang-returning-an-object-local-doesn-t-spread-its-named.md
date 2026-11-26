---
created: 2026-10-29
---
# Erlang: returning an Object local doesn't spread its named fields

```
g = (n Integer) { return x: n }
f = (n Integer) { r Object = g(n); return r }
@test = { :x Integer = f(1); return result: x }
```

- **Current results:**
- js gives result: 1, because return r spreads r's fields into the reply.
- Erlang gives result: null.
- js also fails the implicit-return form { r Object = g(n); r }.
- **Decide first:** should returning an Object spread its fields, in both the return r and implicit forms? Then make all three targets agree.
- **Related:** the validator's knownReturnShape treats a positional return of an Object as having unknown names, on the assumption that it spreads.
