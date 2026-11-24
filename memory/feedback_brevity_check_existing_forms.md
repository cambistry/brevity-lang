---
name: Verify Brevity syntactic forms before treating them as new
description: Default to assuming a Brevity syntactic shape already exists; check docs and tests before proposing alternatives.
type: feedback
originSessionId: f01d4c10-0888-41a8-986f-894a9335c1b3
---
When you encounter a Brevity syntactic shape you don't immediately recognize, default to assuming it is an existing form you don't know about. Verify against `LANGUAGE_OVERVIEW.md`, `LANGUAGE_FEATURES.md`, and the `__tests__/` directory before treating it as a new proposal or inventing alternatives.

Specific shapes I have misread as new when they already exist:

- **Lineal `= params = body`** is the existing lineal form for functions and handlers (`LANGUAGE_OVERVIEW.md:113-121`). Equivalent to delimited `name = |params| body`.
- **`#name`** is a private function (callable only in defining scope). `@name` is a public handler. Bare `name = ...` is a local function value. See `__tests__/functions/index.md:18-22`.
- **`*` marker** for actor references appears at type position (`count *Integer = 0`) and at constructor-param position (`<inner *>`, `<child: (inner) *>`). It means "this is messageable, not a scalar."
- **`Thing(a: 5)` after a DI header** is a real remote construction call that emits `::new` and stores the returned instance address — not a name-in-scope or a value lookup.

**Why:** In one session I invented "new envelope shapes" and "third syntactic forms" multiple times, only to find each time that the shape was already implemented. Each invention sent the design conversation off-course. Chris explicitly called it out: "I wish you would actually read stuff before holding forth at length. There are so many misunderstandings in your response."

**How to apply:** Before proposing a syntax change or describing a shape as "new," grep `__tests__/`, search `LANGUAGE_OVERVIEW.md` and `LANGUAGE_FEATURES.md`, and read at least one representative test that uses the surrounding form. If you can't find a precedent, only then treat it as new — and even then, ask before designing around it.
