---
created: 2026-04-17
---
# self-as declarations are represented in the service interface

```
<params> {
  self as Text = -> "one hundred"
  self as Integer = -> 100
  @get = -> (num: 100)
}
```

interface:

```
<params> -> {
  get: () -> (Structure)
} | Text | Integer
```
