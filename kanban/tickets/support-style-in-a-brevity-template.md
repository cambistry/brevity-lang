---
status: done
created: 2026-11-11
---
# Support <style> in a Brevity template

**Today:** style is declared in the HTML manifest as style (TextElement ++ ? media: Text) -> *{}. In element content a lone {/} is literal text, so CSS lexes as text, and {{ }} is the reactive hole. No test covers a <style> element end to end.

**Goal:** a <style> built from a template lands in the document, and its CSS takes effect.

*

:document

HTML: (:div, :style)

*

```
sheet = <style>h2 { margin: 0; } .note { color: gray; }</style>
document.body().append!(sheet)
```

**Check:**

- The text reaches textContent unchanged: braces, :, ;, @ rules, comments /* … */, and quotes.
- A <style> only accepts text children. A nested element inside it should be a compile error, not dropped.
- Its media attribute.
- Whether a <style> appended to <body> (rather than <head>) applies. It should, but test it.

**Tests (browser):** a rule in the sheet changes an element's computed style. Plus compile tests: CSS containing every brace and punctuation case lexes as one text child, and an element child inside <style> is rejected.
