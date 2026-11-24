---
status: inbox
created: 2026-10-26
---
# Allow implicit tail expression return in lineal form.

multiple arg return _might_ require parens – though maybe sufficient that they are on their own line?

```
fn
=
x = 123
y = 456
x, y // positional values

...
x: 123, y: 456 // named
```

It’s just an Object, and commas tie it together, perhaps.
