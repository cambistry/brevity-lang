---
status: inbox
created: 2026-11-11
---
# {{ }} for reactive text interpolation beyond element content

**Today:**

- {{ expr }} is the reactive hole only in an element body, e.g. <p>Count: {{ @count }}</p>. It makes a closure child, and the consumer subscribes to it.
- Attributes are whole-field: a quoted literal, or a single { expr } as the entire value (class={ @kls }). They can't mix text and interpolation.
- Double-quoted strings have only the snapshot form #{ expr }, evaluated once. A { in them is literal, and single-quoted strings are raw.

**Want:** a {{ }} hole anywhere text is written makes that text live. That includes element bodies (done), quoted attribute values and double-quoted string literals. It needs no new runtime mechanism: a live string is the existing closure child, written as string syntax.

```
<div class="box {{ @color }}">…</div>
<p title="Hi {{ @name }}">…</p>
@label = "Count: {{ @count }}"
badge(text: "{{ @n }} new")
```

**Want (semantics):**

- "color: {{ @c }}" desugars to roughly () -> "color: " + @c. One hole makes the whole string live.
- Joining a live string with a static one gives a live string.
- #{ } stays the snapshot form everywhere, and a string can mix the two ("#{ a } / {{ b }}"). Snapshot parts are evaluated once, when the string is made.

**Want (type):** a live string is &Text, a read-only reference to a value that changes (see the capability sigils notes; check against their current version).

- A slot or parameter declared &Text subscribes, using multi-re, so the first reply is the initial value.
- Passing a live string to a plain Text slot is a compile error, not a silent snapshot. To take the current value, write an explicit read.
- Manifest slots declare which they accept, e.g. HTML class: Text | &Text and <div> children: List of (Text | &Text).

**Suggested order:**

1. Quoted attribute values, <p title="Hi {{ @name }}">. Consumers already subscribe to whole-field { } attributes, so this follows the same path, and the lexer can reuse the content-{{ }} scanner.
1. Double-quoted string literals that are bound or passed to an &Text slot, including the Text-slot compile error.
1. A published derived cell, @label = "Count: {{ @count }}", a subscription source with no DOM involved.

**Open questions:**

- @label = "…" already reads as a handler definition. What makes it a published derived cell instead?
- Is @template = -> "intro {{ pl }}" a function that returns an &Text?
- Should <style> children accept &Text? The scope-test example relies on live CSS, but scoped-styles-2026-11-09.md proposes List of Text.
- What should a }} inside a string in the expression do ({{ "}}" }})? Today it closes the hole early.

**Today (migration hazard):** a {{ in a double-quoted string or a quoted attribute is literal text, and it would silently become a live hole. Before switching, scan existing strings and attributes for {{ and convert any literal use to {{. That is the same scanner approach used for element content.

**Tests:** for each step, on js, rust and erlang:

- a live value updates the attribute or string when its source changes
- a live string passed to a Text slot is a compile error
- {{ is a literal {{
- a #{ }/{{ }} mix works
- a derived cell's subscribers receive each new value
