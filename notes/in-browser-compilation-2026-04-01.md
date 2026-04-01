# In-Browser Compilation: Footprint Assessment

**Question:** What is the footprint challenge of Brevity compiling in-browser to HTML/JavaScript?

## Summary

Footprint is a non-issue. ~20 KB gzipped for a full in-browser compiler is negligible.

## What you'd bundle

| Component | Lines | Est. minified |
|-----------|-------|---------------|
| lexer.js | 257 | ~3 KB |
| parser.js | 3,200 | ~35 KB |
| ast.js | 184 | ~2 KB |
| validate.js | 864 | ~10 KB |
| JS codegen (6 files) | 1,975 | ~20 KB |
| **Total** | **~6,480** | **~70 KB min / ~20 KB gz** |

Only the JS codegen target ships — Rust and Erlang codegen (~7K lines) stay out.

## For reference

- TypeScript compiler: ~10 MB
- Babel core: ~800 KB min
- Svelte compiler: ~200 KB min
- **Brevity (est.): ~70 KB min / ~20 KB gz**

## Why it's tractable

- Pure JS compiler, zero runtime dependencies
- No native bindings, no LLVM, no tree-sitter
- Pure AST-to-code transform — no file I/O, no network, no child processes
- Two-phase API (`extract()` → `compile()`) already clean entry points
- ES modules throughout — tree-shakeable as-is

## Two distinct questions

**1. Run the compiler in-browser** — Near-zero challenge. Bundle the JS subset above, call `extract()` then `compile()` on a string, get JS source back. Could work today with a bundler pass.

**2. Generate HTML (not just JS)** — Current JS codegen emits actor modules (ES module classes with message handlers), not HTML. Needs:
- A thin HTML shell generator (boilerplate `<script type="module">` wrapper)
- A way to express DOM interactions in Brevity (handlers targeting DOM events?)
- Or: treat the browser tab as an actor whose messages are DOM events

The first is trivial scaffolding. The second is a language design question, not a footprint question.

## Real risks (none are about size)

1. **Import resolution** — Brevity imports are actor-tree messages, not static file imports. In-browser, you need a strategy: bundle all actors? Lazy-load? Service worker as "parent actor"?

2. **Actor runtime** — Compiled JS needs a message dispatch runtime. Currently assumed to be a host process. In-browser, need a lightweight actor scheduler (~200 lines of JS, probably).

3. **`*` references and `extract()` dependencies** — Two-phase compile discovers cross-actor deps. In a browser playground this means compiling multiple files in dependency order, or treating each file independently with stubs.
