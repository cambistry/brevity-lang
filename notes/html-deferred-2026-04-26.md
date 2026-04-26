# HTML/DOM deferred work — 2026-04-26

Pending follow-ups in `src/codegen/browser/runtime.js` after the Node/tree-traversal pass. Both intentionally left out of scope to keep that PR focused.

## 1. Text-node `set node_value: (Text)`

Tree-traversal landed read-only. Text and Comment node actors expose `node_value` as a reader, but it isn't settable.

Making it settable means:
- Adding `set node_value: (Text)` to the Node body (or just to Text/Comment).
- Routing the `set` op in `registerNonElementNodeActor`'s dispatcher — same shape as the element handler's existing `set` branch (read field selector from `to`, look up the DOM IDL property, assign, reply `re: {}, 'bv-a': 'self'`).
- Writing through to `node.nodeValue = value`.

Mirrors the plumbing already shipped for element `set inner_html` / `set text_content` / `set inner_text`.

## 2. Aria sub-rep dedup

Each `el.aria()` call currently mints a fresh `HTML @aria/N` sub-rep — every invocation increments `ariaCounter` and registers a new address.

After the identity-preserving Node traversal pass landed (`nodeToAddr: Map<Node, string>`), the analogous fix for Aria is `Map<Element, ariaAddr>`: on `el.aria()`, look up the existing sub-rep first, return that addr; only mint when the element doesn't have one yet.

Separate concern from Node identity (the underlying DOM is the same Element either way), but the same deduplication shape and a small change.

## Why deferred

The user explicitly scoped both out so the traversal/identity work could ship without scope creep. Both are small additions that follow patterns now established by traversal (set-op dispatch, reverse-lookup map). Pick up if HTML work resumes and either dedup or text-node mutation becomes load-bearing.
