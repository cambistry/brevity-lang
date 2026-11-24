---
status: done
created: 2026-11-11
---
# <style> as a child of an element, scoped with native @scope

hoisted or rewritten. (The class-level shared style in notes/scoped-styles-2026-11-09.md is a separate design.)

<div class="card">

```
  <style>@scope { :scope { border: 1px solid; } p { margin: 0; } }</style>
  <p>inside: styled</p>
</div>
<p>outside: unstyled</p>
```

An inline @scope { … } with no prelude scopes to the <style>'s parent, and :scope is that parent.

**Check:**

- The <style> is a real child at its position, not moved to <head>.
- Rules apply inside the parent's subtree and not outside it, including in sibling elements that have the same tags.
- Two sibling elements, each with its own scoped <style>, don't affect each other.
- Behaviour when the element is moved or removed: the scope follows the parent because it's native.

**Tests** **(browser,** **computed** **style):**

- A rule applies inside the parent's subtree and not to a matching element outside it.
- :scope styles the parent itself.
- Siblings with their own scoped styles stay isolated.

**Note:** @scope support varies by browser (the design note flags Firefox). The tests run in Chromium; record the support floor in the docs.
