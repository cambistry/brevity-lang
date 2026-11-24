---
status: done
created: 2026-05-06
---
# Switch back to `attr: (alias) Type` params

As _proper_ as `(:attr Type)` may be, it just doesn’t read well.

I think we switched because of generic named arguments… but surely that should be the outlier. `fn = (a:, b:) → a + b`.

That’s well-worn territory.

Playing around…

```
(a Type, b: Type)
(a (alias) Type, b: (alias) Type)
(a: :b Type, c: (alias) :d Type)
```

This is probably the right decision, and preserves the prefix colon for inline structure/destructure as well as interface aliasing (on the last line above) if we decide to keep that feature. Also: makes this consistent with interface and type definition syntax.
