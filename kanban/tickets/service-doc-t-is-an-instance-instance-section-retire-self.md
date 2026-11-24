---
status: todo
created: 2026-11-23
---
# Service doc: `":T"` is an instance; `instance` section; retire `%self`

‌

- The compiler's internal form stops spelling a class value as \`':T'\` (opre_types.js:60 asClass): a class value's type is \`*\`; which class it is comes from its binding, not its type.

‌

- \`":T:*"\` → \`":T"\` in every type position; \`$new\`'s \`re\` is \`":T"\`.
- The \`":*"\` node key becomes an \`instance\` section beside \`public\` (service_doc.js:123,

    218-228, 394, 412).

- \`{ "%self": true }\` retired: \`=> self\` on an instance is \`":T"\`; remove SELF / isSelf

    (opre\_types.js:33, type\_enc.js:24, service\_doc.js:299, type\_names.js:105) and the

    \`%self\` entries in browser/dom_documents.js, typed as their element's class.

- The compiler's internal form stops spelling a class value as \`':T'\` (opre_types.js:60                                           
      asClass): a declared actor's type is \`*\`, a class's included; which actor it is comes
      from its binding, not its type.
