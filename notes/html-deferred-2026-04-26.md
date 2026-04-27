# HTML/DOM deferred work — 2026-04-26

Pending follow-ups in `src/codegen/browser/runtime.js` after the Node/tree-traversal pass. Originally two items; one shipped in the ClassList/Dataset batch.

## 1. Text-node `set node_value: (Text)` — still pending

Tree-traversal landed read-only. Text and Comment node actors expose `node_value` as a reader, but it isn't settable.

Making it settable means:
- Adding `set node_value: (Text)` to the Node body (or just to Text/Comment).
- Routing the `set` op in `registerNonElementNodeActor`'s dispatcher — same shape as the element handler's existing `set` branch (read field selector from `to`, look up the DOM IDL property, assign, reply `re: {}, 'bv-a': 'self'`).
- Writing through to `node.nodeValue = value`.

Mirrors the plumbing already shipped for element `set inner_html` / `set text_content` / `set inner_text` — and now for ClassList `set value` and Element `set scroll_top`/`set scroll_left`.

## 2. ~~Aria sub-rep dedup~~ — shipped

Each `el.aria()` call previously minted a fresh `HTML @aria/N` sub-rep. Resolved as part of the ClassList/Dataset batch via the generic `getOrMintSubRep(kind, el, ...)` helper backed by `subRepsByElement: Map<Element, Map<kind, addr>>`. Aria, ClassList, and Dataset all share the dedup pattern; repeated calls of `el.aria()` / `el.class_list()` / `el.dataset()` now return the same wire token across calls.

## Why deferred (originally)

The user explicitly scoped both out so the traversal/identity work could ship without scope creep. The text-node setter remains small but isn't load-bearing — pick up if HTML work resumes and text-node mutation becomes useful.
