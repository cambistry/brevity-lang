---
status: inbox
created: 2026-11-16
---
# Private functions in lambdas

Private functions called from lambdas: two gaps

Per notes/private-names-lexical-2026-11-16.md, a closure or lambda reaches every `#` name of the scopes it's inside.

Today (js):

1. A lambda in a file handler calling the file's `#f` returns the wrapped object instead of the value: #f = -> 3 @go = { g = () -> #f() x Integer = g() return x } replies `[{"positional":[3],"named":{},...}]`, expected `[3]`. (The same lambda inside a class method replies `[3]`.)
1. A lambda calling a function-local `#g` fails to parse ("Unexpected identifier '#g'"): @go = { #g = -> 5 h = () -> #g() x Integer = h() return x }

Done when both reply correctly ([3], [5]) on js, rust and erlang, with tests in __tests__/functions/private.test.js.
