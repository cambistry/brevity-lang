---
status: todo
created: 2026-11-23
---
# Is << better for class composition (than function overload)?

```brevity
C = A << { } << *{ }

C << B
```

---

```brevity
fn = (x Integer) { … }

fn ++= (x Text) { … }
```

---

Which also suggests inline overload:

```brevity
fn = (x Integer) { … } ++ (x Text) { … }
```

++ reads better for overload, since feels more left-to-right.
