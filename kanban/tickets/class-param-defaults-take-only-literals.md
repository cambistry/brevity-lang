---
status: done
created: 2026-11-10
---
# Class param defaults take only literals

  \@U = (b Integer = 1 + 2) \*{} fails with Expected RPAREN, got PLUS '+'. (b Integer = 3) works and renders U (? Integer) -> \*{}.

‌

  _Cause._ Class param defaults go through parseDefaultLiteral (src/parser.js ~3354). It takes a number, a string or a similar literal and nothing else, so the +

  is left over. Function-param defaults should be compared to see whether they already allow expressions.

‌

  _Decide first._ Should class param defaults allow expressions, and if so, what can they refer to: other params, file-level names, anything in scope? Where is

  the default evaluated: on the caller's side or in the class's constructor? And how does it render in the interface, where today a default shows only as ??

‌

  _Interaction with ++._ notes/class-extends-plusplus-2026-11-10.md reads parents and params left to right. A + inside a default comes after = and can never count

  as ++, so expression defaults would not make the parent/param split ambiguous. Add a test for that: (A ++ n Integer = 1 + 2).

‌

  _Tests._ Parse, runtime value, and interface render, on js, rust and erlang. Include a default that uses a negative number, (b: Integer = -1), whatever the

  decision on expressions.
