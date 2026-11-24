---
status: todo
created: 2026-11-23
---
# Is << better for class composition (than function overload)?

C = A << { } << *{ }

C << B

---

fn = (x Integer) { … }

fn ++= (x Text) { … }

---

Which also suggests inline overload:

fn = (x Integer) { … } ++ (x Text) { … }

\++ reads better for overload, since feels more left-to-right.
