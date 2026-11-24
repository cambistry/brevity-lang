---
status: inbox
created: 2026-11-23
---
# Investigate: element extension (names on the element)

Design: notes/element-extension-2026-11-23.md (proposal; the `@name={ … }` form is the liked part, `^{ … }` is tentative)

A tag head that declares names extends the element, as `HTML::div ^ { … }`. The element itself becomes the receiver, with no wrapper actor:

Receiver = -> <div ^{ version *Integer = 1 } @bump={ version <- version + 1 }>{ version }</div>

```
rx = Receiver(); rx.bump; body.append!(rx)
```

This replaces the 2026-04-27 behaviour (notes/session-2026-04-27.md), which lifts tag-head declarations into the enclosing actor.

Find and report (no changes yet):

- Today's pipeline end to end: the lexer's `bvBlock` capture (src/lexer.js; it triggers when the first attribute starts with `@` or a character outside `[a-zA-Z0-9_-:]`), the parser's `AnonymousHtmlActor` (parsePrimary and parseReplyFields), `liftReactiveElements` / `synthesizeReactiveElementBodies` (src/extract_passes.js), and what they emit on each target that supports HTML.
- Confirm or rule out the suspected drop: a head that declares only `@go = { … }` and no ref cell. The pass merges functions only inside `if (liftedStateVars.length > 0)`. Write a failing test if it drops the function, and keep the test.
- Every test and doc that uses tag-head declarations (start with __tests__/html/reactive_element.dom.test.js). Classify each under the new design: an `@` attribute, a declaration that moves into `^{ … }`, or a reactive attribute that stays (`style={ … }`).
- The lexer and parser: what it would take to tokenize a head that mixes plain attributes, `@name={ … }` and `^{ … }` in any order, instead of capturing it raw.
- Hosting: on the browser target, how a DOM node (e.g. `HTML @div/N` in browser/runtime.js) could answer extra published names by dispatching to compiled layer functions, and where the layer's cells would live. Note what shipping the layer code to a remote HTML host would take on Rust and Erlang.
- The open question of what `^{ … }` runs in: compare the element's own layer with a transient frame of the enclosing code (notes/escaping-frames-2026-11-23.md), using what the runtime already supports.

Output: the current-pipeline map, the result of the drop check, a classified list of existing uses, a sketch of the tokenizer change, and a recommendation on hosting and on where `^{ … }` runs.
