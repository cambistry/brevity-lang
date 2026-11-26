---
created: 2026-04-15
---
# Return-as interface shape

Currently, a constructor interface has this shape:

```
<params> -> { service }
```

Needs to be able to express both self-as and return-as types. Proposal: type-union:

```
<params> -> { service } | Text | CustomType
```
