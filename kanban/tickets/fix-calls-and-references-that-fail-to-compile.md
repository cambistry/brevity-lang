---
status: done
created: 2026-11-01
---
# Fix ! calls and references that fail to compile

  **\*\*Passing a \`!\` function by name crashes the compiler\*\***

‌

  \`\``brevity

  x *Integer = 0

  bump! = { x <- 1 }

  take = (f () -> ()) { f() }

  \@go = {

    take(bump!)

    return 1

  }

  \`\``

‌

  This fails with an internal error: \`Cannot read properties of undefined (reading 'type')\`. \`&bump!\` is a parse error

  (\`Expected RPAREN, got BANG\`), so only an inline function can be passed.

‌

  Expected: a named \`!\` function can be referenced in whichever form is correct (check \`docs/SYNTAX_CRIB.md\` and the

  \`&name\` handling first). Passing one to a \`->\` slot gives the normal effect error, and no internal errors reach the

  user.

‌

  **\*\*\`@x(…)\` self-calls don't compile on Rust\*\***

‌

  \`\``brevity

  n *Integer = 0

  \@bump! = { n <- n + 1 }

  \@go! = {

    \@bump!()

    \@bump!()

    return n as Integer

  }

  \`\``

‌

  This passes validation, and then \`rustc\` fails: \`expected expression, found '@'\`.

‌

  It's also why chains from a call on this actor (\`bump!(1).add!(2)\`) are a compile error on every target. Once

  self-calls work, decide whether to allow those chains.

‌

  **\*\*Tests:\*\*** validation for the accepted reference form and the \`->\` rejection. Add the runtime cases to an existing

  \`bang.test.js\` fixture, so there's no new Rust build.
