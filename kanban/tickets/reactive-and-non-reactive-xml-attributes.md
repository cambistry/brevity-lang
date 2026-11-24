---
status: done
created: 2026-04-24
---
# reactive (and non-reactive) XML attributes

Full field only. No quotes.

```
@classes Text! = "basic"
<div class={ @classes }> ...
...
@constant Text = "normal"
<div class={ @constant }> ... // should inline immediately
```
