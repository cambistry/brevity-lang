# Session 2026-11-07 — examples site viewer, dogfooded

The examples site (`docs/site/`, served by `node docs/serve.js`) gets a
viewer written in Brevity: `docs/site/viewer.bv`. Left pane is an accordion
of an example's source files (`<details>`), right pane is the example
running in an `<iframe>`. The first example moved to `docs/site/hello/`.

The viewer is the rough surface to design against. Holes it hit, in order:

## Fixed

- **An element-valued `{ expr }` child rendered as its address text.**
  `<div>{ #badge() }</div>` showed `#<@span/1>`. The child slot subscribes
  to the closure and wrote every value into a text node. Now a value naming
  a live element takes the slot (and a later text value puts text back) —
  `runtime.js`, element subscription reply. Tests in
  `__tests__/browser/dom_subscribes_to_children.browser.test.js`.

## Open

- **Template closures can't see a function's locals.** In
  `#panel = (path Text) -> <summary>{ path }</summary>`, the `{ path }`
  closure compiles to a file-level `@0` handler where `path` is free:
  renders empty, and `open={ open }` resolved to the global `window.open`.
  Closures capture actor cells, not call-frame locals. Needs a design:
  a per-call closure environment (closure actor per invocation?), or
  values substituted at construction when the captured name isn't a cell.
  Silent failure is the worst part — should at least be a compile error.
- **No fetch.** `document.eval` is synchronous, so the viewer reads source
  with a synchronous XHR through it. Wants a network/fetch service in DI.
- **No list → children.** One panel per file, written by hand.
- **No query string / location.** The viewer shows one fixed example.
