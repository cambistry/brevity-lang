---
status: inbox
created: 2026-11-01
---
# Add a compiler warning channel and the warnings waiting on it

  The compiler can only throw errors. These agreed warnings aren't built:

‌

- A \`!\` or \`.\` function that has no definite write and rests only on a \`~>\` call. It compiles silently today.

- A \`!\` that returns its receiver's class without being the receiver, which is the one misread chain that still

  type-checks.

- The \`add_child!\` case from the session note.

‌

  **\*\*Expected:\*\*** \`compile\` returns warnings alongside its output, and tests can assert on them. Decide how the CLI and

  Tensile display them.

‌

  **\*\*Tests:\*\*** a validation case for each warning, plus a check that clean code produces none.
