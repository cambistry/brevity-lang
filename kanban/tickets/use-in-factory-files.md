---
status: done
created: 2026-11-18
---
# `use` in `*` factory files

  Design: notes/use-di-2026-11-17.md ("Factory files and the trailing \`*\` section")

  Depends on: \`use\` statements replace the DI header

‌

  Summary

  Allow \`use\` in the constructor body of a factory file, in all three head forms: the lineal \`*\`

  header, `\*{ … }\`, and \`( params ) [->] \*{ … }`. Entries are hoisted into the file manifest and

  bound once at load. Calls made by instance code come from the instance.

‌

  Semantics

- Placement: anywhere in the constructor body's top-level scope. It's hoisted the same way as in

    a singleton file, and the name is visible throughout the constructor body and the instance's

    handlers.

- Inner scopes within the constructor body follow the inner-scope \`use\` ticket.

- \`from\` follows the calling code: a call made by instance code carries the instance's address,

    so the dependency can tell instances apart.

- One manifest: the same entry used by many instances, or written twice, is one manifest entry and

    one host binding.

‌

  Errors

- Lift "\`use\` in a factory file is not supported yet".

- Dependency entries in the factory's params stay an error that points to \`use\`.

‌

  Work

- Parser: accept \`use\` in the constructor body of all three factory head forms.

- Collect into the file manifest; dedupe.

- Codegen for all three targets: instances resolve \`use\` names to the shared binding and send from

    their own address.

‌

  Tests

- Each of the three factory forms with a \`use\` in its constructor body, whose instances call the

    dependency.

- \`use\` after other constructor-body statements (hoisting).

- Two instances calling the same dependency: the dependency sees two different \`from\` addresses.

- The same entry twice: one binding.

- A dependency entry in the factory's params: the error that points to \`use\`.
