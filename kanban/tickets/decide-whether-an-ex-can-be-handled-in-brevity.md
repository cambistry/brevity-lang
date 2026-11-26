---
status: inbox
created: 2026-11-02
---
# Decide whether an ex can be handled in Brevity

**Today:** nothing in the language can handle a failed call. catch is a label-based early exit, so a failed as or remote call always ends the enclosing call. There's no way to write "use this reply if it's an Integer, otherwise do something else".

**To decide:**

- Is a handling form wanted at all, or should callers branch on a union (x Integer | Text = Svc.t())?
- If wanted, does it extend catch or use a new form?
- Should it see the ex value, such as as Integer: got Text?

**Done when:** the decision is in a note in notes/, with an implementation ticket if the answer is yes.
