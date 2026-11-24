---
status: done
created: 2026-11-01
---
# Correct how generated docs describe ! functions and classes

  **\*\*A public class named with \`!\` shows its internal name\*\***

‌

  \`\``brevity

  \@W! = *{

    Svc.ping!()

    \@get = { return 1 }

  }

  \`\``

‌

  This generates `W\_\_w () -> *{ … }\`. Callers see a name they can't use, and the \`->` says construction only reads. The

  parser renames \`W!\` to `W\_\_w\`, \`buildServiceDocument\` prints that name, and \`formatConstructorSig\` always writes \`->`.

‌

  Expected: \`W! () => *{ … }\`. Also decide whether the type annotation \`x W!\` stays an error.

‌

  **\*\*Mixed return paths show only one outcome\*\***

‌

  \`\``brevity

  n *Integer = 0

  \@go! = (b Boolean) {

    n <- 1

    if b { return 1 }

    return self

  }

  \`\``

‌

  This generates \`go! (Boolean) => self\`, though it can also return an Integer, so a caller who chains on it can get a

  value. \`formatPublicFnSig\` reads the first top-level \`Reply\`, which ignores returns in branches.

‌

  To decide: how a doc states both outcomes, and whether a function with mixed returns can be chained on at all.

‌

  **\*\*Tests:\*\*** add to `\_\_tests\_\_/services/actor_interface.test.js\`, and read entries back through \`parseInterface`.
