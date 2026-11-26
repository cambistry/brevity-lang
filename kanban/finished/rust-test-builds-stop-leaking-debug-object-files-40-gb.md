---
created: 2026-11-17
---
# Rust test builds — stop leaking debug object files (~40 GB)

Problem

Each Rust test worker (rust/w<n>/) builds every fixture in one cargo workspace. On macOS the dev profile keeps debug info in separate object files (split-debuginfo = "unpacked"), so every build leaves its codegen-unit objects (brevity_actor-<hash>.*.rcgu.o) in target/debug/deps. They are never removed: a fixture's units have different names from the previous fixture's, so nothing overwrites them.

Measured: ~170 files / ~15 MB per build; 552,715 files in one worker's deps/; 5.3–6.7 GB per worker, ~40 GB across seven workers.

The debug info is never used: the profile already sets strip = true, which removes it from the binary.

Change

1. rust/Cargo.toml [profile.dev]: add debug = false (with a comment saying why). The runner copies this file into each worker at setup; each worker rebuilds its dependencies once (~15 s).
1. One-time cleanup: delete rust/w*/target (build output, gitignored). rust/cache/ (cached fixture binaries, 1.5 GB) is untouched; cache entries are keyed by the generated code and stay valid.

Findings (scratch crate, same Cargo.toml and lockfile, real fixtures)

- With debug = false, builds leave 0 object files behind.
- Build time is unchanged or slightly better (fixtures: 2.4–7.7 s, not counting the first build after the profile change, which also rebuilds dependencies).
- Binary size is slightly smaller (2.72 MB vs 2.83 MB).
- Splitting the shared Rust runtime into its own crate gives little benefit, so it is out of scope. The shared part is ~43 KB of 96–580 KB fixtures. The binaries are statically linked and mostly dependency code, so disk use would not change. The runtime costs well under 1 s of a from-scratch build.

Acceptance

- After a Rust test file runs, rust/w<n>/target/debug/deps has no brevity_actor-*.rcgu.o files.
- Worker target dirs stay at dependency size (~hundreds of MB) across runs rather than growing per fixture.
- Rust tests pass.

Follow-up (separate)

- functions/bang generates a 580 KB main.rs; check whether, like the Erlang text_methods fixture, something in codegen is blowing up its size.
