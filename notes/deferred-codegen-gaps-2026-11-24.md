# Deferred codegen gaps — 2026-11-24

Two known gaps, both checked against the code on 2026-11-24.

## `catch` exits through `over` / `reduce`

`over` and `reduce` take a callback: the body runs inside a function, not a sequential block.
`catch #label { over … |item| { #label } }` can't use the JS lowering of a label exit
(`genCatchStatement`, `src/codegen/javascript/statements.js`, emits
`_lbl_<name>_<n>: { … break … }`), because `break` can't cross a function boundary. `catch` is
tested with `repeat while` and brace forms only.

Any non-local exit through a callback-taking construct needs a thrown sentinel and try/catch on
JS, and the equivalent on Rust where iteration uses closures. Erlang already uses a tagged throw.

## Bare set on a remote-bound local

The runtime handles a bare set on a text node: `{op: [[v], '$set'], to: <node addr>}` with no
field selector writes `node.nodeValue` (`registerNonElementNodeActor`,
`src/codegen/browser/runtime.js`); Element and Document ignore it.

Source doesn't reach it. With `node = el.first_child()`, `node` is a wire token, and
`node <- "x"` goes through the `ActorSetStatement` branch in
`src/codegen/javascript/statements.js`, which always emits `target.receive(...)` on the JS
variable: right for a child-actor variable, a throw for a wire-token string. `ActorFieldSet`,
just above it, has the remote branch (`ctx.depSource`, `this.#binding.post`) to mirror.

The validator may also want the manifest to declare which types accept a bare set.
