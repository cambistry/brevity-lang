---
status: todo
created: 2026-11-15
---
# Thought about trace/ctor encoding

    **What I'd do: percent-encoding, applied only when an address goes into or comes out of a whitespace-separated list:**

- % becomes %25, space %20, tab %09, LF %0A, FF %0C, CR %0D.

- Decoding is the exact reverse, so nothing is lost. Everything else passes through unchanged.

- trace="main:template My%[20Notes.bv](http://20Notes.bv "‌"):component" round-trips, and ~= matching still works because each entry contains no whitespace.

‌

    **Why this fits:**

- **It's ugly only in the rare case.** Ordinary entries look exactly like the address. Only the bad-practice filenames, and the even rarer %, change.

- **Everyone** **already knows it,** from URLs and [file: paths](file: path "‌"). Tools can decode it without anything Opre-specific.

- **It keeps layers separate.** The Opre address stays exactly as decided: spaces ordinary, colons quoted. The encoding belongs to the list format, the same way #<…>

      escapes belong to payloads.

- **One cost:** anyone writing a CSS selector against trace has to write the encoded form, [trace~="My%[20Notes.bv](http://20Notes.bv "‌"):component"]. That's acceptable for an edge case.

‌

    If you want a rule to write down: "An address in a whitespace-separated list is percent-encoded for % and ASCII whitespace; nothing else is encoded." That's one

    sentence and has no exceptions.
