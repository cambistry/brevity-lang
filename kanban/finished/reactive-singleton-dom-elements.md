---
created: 2026-04-24
---
# Reactive singleton DOM elements

Reactive code inlined right into the HTML:

```
el = <div
  class="reactive"
  @color Text! = "black"
  style="color: { @color }"
>
  I change color!
</div>
...
el.color <- "red"
```
