---
status: done
created: 2026-11-11
---
# Reactive @scope styles

  **Goal:** a {{ }} hole inside a scoped <style> restyles the element when its value changes.

‌

  \@reactive\_color\_string *Text = "black"

‌

  el = <div>

    <style>@scope { :scope { color: {{ \@reactive\_color\_string }}; } }</style>

    scoped

  </div>

‌

  Setting \@reactive\_color\_string <- "red" should change the div's computed colour.

‌

  **Today:** <style> is a TextElement, whose children slot is List of Texts. {{ }} makes a closure child that the runtime subscribes to. scope-test/app.bv does this

  today with one whole-sheet hole, <style>{{ "@scope … " + \@color + " …" }}</style>. A hole in the middle of the CSS text, as above, hasn't been tested.

‌

  **Check:**

- A {{ }} mixed into CSS text compiles: text, closure and text in one <style>.

- The first value renders, and an update replaces the sheet's text with no leftover runs.

- Several holes in one sheet each update.

- An outside #set on the cell restyles the element.

- Update cost: each change rewrites the whole sheet, which is fine for now but worth noting.

‌

  **Design** **questions:**

- Should <style> children accept &Text? The design note proposed List of Text (no reactive CSS), but this ticket and scope-test rely on it. That decision

    should go in the note.

- Is \@scope with a bare color: (no :scope { }) worth supporting, or is :scope { } the documented form?

‌

  **Tests** **(browser):**

- Initial computed colour.

- The colour after <- from inside the actor and after an external #set.

- Two holes updating independently.

- The scope-test example, rewritten with a mid-text hole.
