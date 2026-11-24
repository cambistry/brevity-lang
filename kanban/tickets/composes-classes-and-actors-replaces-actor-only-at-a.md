---
status: done
created: 2026-11-19
---
# `^` composes classes and actors (replaces `++`); `actor` only at a definition's head

  Design: notes/caret-composition-2026-11-19.md

‌

  Summary

  A definition is a stack of layers joined by \`^\`; a layer further right takes

  precedence. Layers: a parent class (\`T\`), a constructor (`\*{ … }\`, \`(p) \*{ … }`),

  a singleton (\`{ … }\`), or, as the first layer only, \`actor { … }\`.

‌

    T = actor { … } ^ *{ … }

    V = T ^ U ^ { … } ^ *{ … } ^ { … }

    C = A ^ B          // B takes precedence

    U = V^             // empty subclass (preferred without the space)

    D = T ^ (n Integer) *{ … }

‌

  \`++\` has no meaning on classes afterwards. \`actor\` begins a definition only:

  \`s = actor { … }\`, the whole-file \`actor { … }\`, or the head of a \`^\` chain.

‌

  Phase 1 — syntax, today's semantics

    Parser (src/parser.js)

- Parents: parseExtendsParents / isBareExtendStart / parseBareExtendClass join on

      POWER instead of PLUSPLUS. Postfix \`V^\` (POWER before a definition end) is the

      empty subclass.

- Class block: \`(p) *{ … } ^ { … }\` replaces \`… ++ actor { … }\`

      (isTrailingMembersStart / parseTrailingMembers). A singleton head

      \`actor { … } ^ (p) *{ … }\` is accepted with the same meaning as the trailing

      form (today a class block never answers for an instance, so order doesn't

      change behaviour yet).

- A chain is a composition by its tokens when it has a `\*{\`, \`(…) \*{\` or \`{`

      layer after \`^\`, or an \`actor {\` head. A chain of names only (\`C = A ^ B\`) is

      left to validation, which decides by whether the head is a class in scope

      (the existing "'X' is not a class in scope" check) — otherwise it's an

      exponent expression.

- More than one singleton layer, or a class layer after a singleton head

      (\`actor { … } ^ T\`), is an error in phase 1 (see Phase 2).

- \`actor\` after \`^\` doesn't parse, the trailing singleton included:
          T = *{ … } ^ actor { … }    // syntax error
          T = *{ … } ^ { … }          // correct
        No special-case message (notes rule: no detectors for non-forms). Add a test
        that the first fails and the second compiles.

- \`++\` on classes is gone. If PLUSPLUS has no other use, drop it from the

      lexer so \`++\` lexes as two \`+\` and fails generically.

‌

    Service documents (src/codegen/javascript/types.js)

- PARENTS_RE and splitLeadingParents: \`Text Node ^ -> *{}\`,

      \`C A ^ B ^ (c: Integer) -> *{ … }\`.

- Class members: `\*{ … } ^ { members }\` replaces \`\*{ … } ++ actor { members }`

      (parseSignature).

- The document emitter writes \`^\`.

‌

    Tests

- Rewrite every \`++\` class form to \`^\` (subclasses, super, class_singleton,

      public\_class, subclass\_interface, interface_notation, star, …).

- New tests per form above, including \`V^\`, a singleton head, \`C = A ^ B\`

      resolved as composition vs \`n = x ^ 2\` as exponent, and a name-only chain

      whose head isn't a class (exponent, or the existing not-a-class error).

- Full suite green (\`npm run test\`).

‌

  Phase 2 — layering semantics (blocked on the note's open questions 1–4)

- Whether singleton layers answer for an instance (fall-through from the top),

      and how \`C.x\` resolves.

- Several singleton layers; a parent's singleton as a layer; \`super\` across

      mixed layers.

- Then lift the phase-1 restriction on multiple singleton layers.

‌

  Out of scope

- \`A = actor { … } ^ T\` (class layered over a singleton, T first responder).

- Lineal spellings of a chain.
