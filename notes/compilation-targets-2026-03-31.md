# Compilation target ideas

Current targets: JS, Rust, Erlang

## Natural actor-model fits

**Swift** — Swift actors (5.5+) are a first-class language feature. Brevity's
model maps almost 1:1. Opens iOS/macOS native. Nobody else offers "write actors,
get a native iOS app." Probably the highest wow-per-effort ratio.

**Go** — Goroutines + channels are actors in all but name. Massive server-side
adoption. Simple language = simple codegen. The pitch: same actor runs as a Go
microservice or a JS frontend.

**Dart** — Dart isolates literally ARE actors — separate heaps, message-passing
only. Flutter gives you iOS + Android + web + desktop. Combined with Brevity:
"write actors once, get native mobile UI." The platform reach is enormous.

## High-visibility / ecosystem plays

**Python** — Sheer gravity of the ecosystem. Even basic actor support turns
heads. The killer angle: Brevity actors orchestrating ML pipelines, calling into
numpy/torch. "Actors as the coordination layer for AI agents" is a very current
pitch.

**Kotlin** — Coroutines + channels map well. Opens Android native + JVM
server-side. Combined with Swift, you'd have the "full-stack mobile + backend
from one language" story.

## The "holy shit" tier

**Wasm Components** — Not a language, but the Wasm Component Model is explicitly
designed for sandboxed modules communicating via typed interfaces. That IS the
actor model. A Brevity actor compiled to a Wasm component runs in browsers, edge
workers (Cloudflare/Fastly), embedded runtimes — anywhere. And it composes with
components written in any other language.

## Recommendations

For maximum splash:
1. Swift — easiest to demo, natural mapping, nobody else does it
2. Go — huge audience, trivial codegen, instantly credible for backend
3. Python — biggest possible audience, "AI agent orchestration" is the zeitgeist

For maximum platform reach with minimum targets:
- JS (browser/server) + Rust (systems/Wasm) + Swift (Apple) + Kotlin (Android/JVM) + Erlang (distributed)
- Five targets covering essentially every platform that matters.

## Feasibility note

The fact that JS, Rust, AND Erlang already work — three very different runtime
models — is the hard part. Adding Go or Swift would be substantially easier than
the Erlang or Rust targets were, since their concurrency models are closer to
what Brevity already expresses.
