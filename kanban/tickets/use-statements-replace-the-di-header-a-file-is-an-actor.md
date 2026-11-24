---
status: done
created: 2026-11-18
---
# `use` statements replace the DI header; a file is an actor with no header

  Design: notes/use-di-2026-11-17.md

  Depends on: Retire the trailing \`*\` section (land before or with)

‌

  Summary

  Dependencies are declared with \`use\` statements instead of a file header. The entries inside \`use\`

  are unchanged: exactly the forms the header accepts today. A file that doesn't open with a

  constructor form is an actor and needs no `\*\*\` header or \`actor { }` wrapper.

‌

  Syntax

- \`use <entries>\`: one or more entries, comma-separated, with the same entry grammar the header

    takes today (\`:document\`, \`HTML: (:div)\`, `"[svc.bv](http://svc.bv "‌")": Svc\`, renames, types, \`#`).

- A file may contain any number of \`use\` statements. Their entries accumulate.

- A singleton file may optionally open with \`actor {\` and close with \`}\`. Its \`use\` statements

    then go inside the braces, after the \`actor {\` line.

‌

  Example

‌

      use :HTML, "[svc.bv](http://svc.bv "‌")": Svc

‌

      count *Integer = 0

‌

      new =

      \*

        seed Integer

      \*

      count <- count + seed

‌

  Semantics

- File kind: a file that opens with a constructor form (lineal `\*\` header, \`\*{ … }`,

    \`( params ) [->] *{ … }\`) is a factory, as today. Any other file is an actor (\`ast.fileKind\`

    'singleton', or 'class' when it declares \`new\`).

- Hoisting: \`use\` doesn't have to be at the top of the file. The compiler collects every \`use\` in

    the file actor's top-level scope into the file's dependency manifest, and the host binds the whole

    manifest at load. A \`use\` written after handlers or other declarations behaves the same as one

    written first, and its names are visible throughout the file actor's top-level scope.

- Scope: a top-level \`use\` name is visible to everything lexically inside the file actor, including

    nested actors, functions, and a \`new =\` constructor (through the closure).

- The same entry declared twice is one manifest entry and one binding.

‌

  Errors

- \`use\` in any inner scope (nested \`actor { }\`, class body, function body, \`new =\` constructor

    body, conditional or loop body, etc.): error, "\`use\` in inner scopes is not supported yet". The

    inner-scope \`use\` ticket lifts it.

- \`use\` in a factory [file: error](file: erro "‌"), "\`use\` in a factory file is not supported yet". The factory-file

    \`use\` ticket lifts it. (Factory files take no DI today either, so nothing regresses.)

- A lineal `\*\*\` header: parse error that points to \`use`.

- A \`( DI ) actor { }\` header: parse error that points to \`use\`.

- "A `\*\` header takes no DI — inject it in a \`\*\*\` header": re-point the message, since \`\**` is

    gone. Dependency entries stay an error in a factory's params.

- The "a file header must open the file" rule is gone for DI. A whole-file \`actor { … }\`, or a

    factory's constructor form, still has to open the file.

‌

  Out of scope

- Dropping the \`:\` sigil from top-level entries: separate ticket.

- \`use\` in inner scopes: separate ticket.

- \`use\` in factory files: separate ticket.

- \`from\` tagging by lexical calling scope (from-names-calling-scope-2026-11-14.md).

‌

  Work

- Lexer/parser: \`use\` keyword and statement; optional whole-file \`actor { … }\`. Replace the `\*\*`

    and \`( DI ) actor { }\` header parsing with the errors above, and add the inner-scope and

    factory-file errors.

- Collect manifest entries from every top-level \`use\`; dedupe.

- Codegen for all three targets (js, rust, erlang) builds the manifest from \`use\` instead of the

    header.

- Migrate tests and examples from `\*\*\` / \`( DI ) actor { }\` to \`use`.

‌

  Tests

- A file with \`use\` at the top.

- \`use\` after other declarations (hoisting): the name works in code above it.

- Several \`use\` statements, and several entries in one statement.

- Each existing entry form through \`use\`: \`:name\`, a rename, a path, a type, a nested destructure

    \`HTML: (:div)\`, and \`#\`.

- The same entry twice: one binding.

- A file wrapped in \`actor { … }\` with \`use\` inside.

- A file with no header and no \`use\`.

- A file with \`use\` and a \`new =\` constructor whose instances call the dependency.

- Two instances built by \`new =\` calling the same top-level \`use\` dependency: the dependency sees

    two different \`from\` addresses (each instance's), not the file's.

- The errors: \`use\` in a nested actor, \`use\` in a function body, \`use\` in a factory file, `\*\*`

    header, \`( DI ) actor { }\` header, and a dependency entry in a factory's params.
