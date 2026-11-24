---
status: done
created: 2026-04-14
---
# Service block implicit `return-as Type`

```
C = <> {
  @fn = { 123 }
  “string“
} // implicit self as Text declaration
c = C()
c.fn == 123
t Text = C()
t == "string"

Double = <input Integer> {
  @original = input
  → (input * 2) as Integer
}
d = Double(100)
d.original == 100
d as Integer == 200
```
