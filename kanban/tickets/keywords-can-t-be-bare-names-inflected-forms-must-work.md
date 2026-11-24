---
status: inbox
created: 2026-11-03
---
# Keywords can't be bare names; inflected forms must work

Rule: a keyword (src/lexer.js:1: return, over, if, as, self, set, …) can't be used in bare form as any kind of name. That covers functions, cells, locals, params, classes and types, including ::over, because :: uses the name uninflected. Inflected forms are ordinary names: @over and #over.

Problem: the bare form is rejected today, but by accident, with messages that don't say why. And one of the inflected forms is broken:

```text
┌────────────────────────────────────────┬───────────────────────────────────────────────────────────┬───────────────────────────┐
│                 Source                 │                           Today                           │         Should be         │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ over = (n Integer) { … } (also if = 1) │ file actor takes no body opener — remove the leading '='  │ keyword error             │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ over = 1 in a body                     │ Unexpected token in expression: EQUALS                    │ keyword error             │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ (over Integer)                         │ Expected RPAREN, got KEYWORD 'over'                       │ keyword error             │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ ::over = (a: Integer)                  │ Expected IDENT, got KEYWORD 'over'                        │ keyword error             │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ :over = f()                            │ compiles, then any use of over fails with Expected RBRACE │ keyword error at the bind │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ #over = … / #over(1)                   │ works                                                     │ works                     │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ @over = … / @over *Integer = 0         │ the declaration compiles                                  │ works                     │
├────────────────────────────────────────┼───────────────────────────────────────────────────────────┼───────────────────────────┤
│ @over(1) / return @over                │ Unexpected token in expression: AT                        │ works                     │
└────────────────────────────────────────┴───────────────────────────────────────────────────────────┴───────────────────────────┘
```

The error should name the keyword and the position, e.g. 'over' is a keyword and can't name a function; use '@over' or '#over'.

To decide:

- **Member access:** a published @over is consumed from outside as .over. Svc.over() fails today with an unrelated message (A trailing '.' no longer makes a function silent). If @over is allowed, .over has to work, or callers can't reach it.
- **Named keys:** return over: 1 compiles, but the named param (over: n Integer) fails with Expected RPAREN. Is a key a name under this rule, or a label that a keyword may fill? If keys are allowed, :over would stay an error (it binds the bare local over), and over: n = f() would be the way to destructure it.

Done when:

- Every bare position in the table fails with the keyword error.
- @over works in declarations and in expressions, on every target, as #over already does.
- Member access and named keys behave as decided.
