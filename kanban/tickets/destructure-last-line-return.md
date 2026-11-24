---
status: done
created: 2026-04-08
---
# destructure last line return

This works:

[\@go](https://github.com/go "‌") = {
x Integer = 1
\-> :x
}
This does not:

[\@go](https://github.com/go "‌") = {
x Integer = 1
:x
}

but should. Should work as well with mixed and aliased returns:

[\@go](https://github.com/go "‌") = {
x Integer = 1
y Integer = 2
z Integer = 3
x, :y, alias: z
}
=> 1, y: 2, alias: 3

And in parens:

[\@go](https://github.com/go "‌") = {
x Integer = 1
y Integer = 2
(:x, :y)
}
=> x: 1, y: 2

IS THIS DONE???
