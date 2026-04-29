# Write Brevity Conservatively

Use this skill when writing or editing Brevity in an application repo.

## Goal

Write Brevity that matches the current tested subset and is safe for app work.
Do not try to use the whole language. Prefer boring, explicit forms.

## Working Rules

- Treat a `.bv` file as the main actor or factory unit.
- Use `@name` for the public message surface.
- Use a top-level `< ... >` header for dependencies or constructor-like inputs.
- Prefer named parameters and named returns.
- Prefer explicit intermediate bindings over clever one-liners.
- Keep message flow visible: request, reply, transform, return.
- If a construct is not covered by this pack, choose a simpler shape instead of inventing syntax.

## Safe Workflow

1. Identify the kind of file you are writing:
   app actor, service-backed actor, factory, DOM-producing actor, or remote-instance actor.
2. Start from the closest pattern in `references/demo-safe-patterns.md`.
3. Keep to the subset in `references/compact-language-profile.md`.
4. If the needed shape is not in this pack, choose a simpler current pattern
   from the test-backed docs.

## Biases

- Prefer inline public handlers that are easy to scan.
- Prefer one public handler per visible behavior.
- Prefer state refs and explicit update handlers over hidden mutation.
- Prefer explicit service interfaces in dependency headers.
- Prefer local clarity over compression.

## Boundaries

- Stay within the forms shown in this pack.
- Keep dependency interfaces explicit in `< ... >` headers.
- Treat transport, discovery, and cluster infrastructure as surrounding services
  unless the app explicitly implements them.
- Use documented wire examples only when the task is about CAM protocol.
