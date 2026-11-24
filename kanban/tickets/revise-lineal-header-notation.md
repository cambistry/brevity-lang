---
status: inbox
created: 2026-11-02
---
# revise lineal header notation?

Thinking…

```
fn =
(
  param
  param
)
body
```

But - a lineal body has special termination rules. Unsure if this adequately opens the style (as distinct from delimited).

I think it might work, because a delimited single-statement function requires the lambda arrow. So the _omission_ here indicates lineal form. Assuming that the header is recognized as a param list and not just an object literal.

Delimited would remain:

`fn = (params) [->] { body }`

`fn = (params) → statement`

Lineal constructor would remain:

```
C =
\*
  param
  param
\*
body
```

I like its close approximation of delimited. One could also mix-and-match:

```
fn = (
  lineal_params
) {
  delimited_body
}

fn = (
  lineal_params
)
-> statement
```

OTOH, not possible to mix the other direction!

```
fn = (param, param)
... ?
```

This is one reason that we developed the = notation. Is it reason enough? I doubt it. Nor to create a special syntax for this case. So a lineal header can find of hobble into curly braces (maybe), but not the other way around.
