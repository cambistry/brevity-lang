---
status: done
created: 2026-04-24
---
# Template non-reactive interpolation

```
constant = “text”
<p>{ constant }</p>
```

Since `constant` is not going to change, this is inlined directly.

Should also intermix with text:

```
constant = “text”
<p>pre { constant } post</p>
```

as well as in attributes as interpolated strings:

```
cls = "hero"
<h1 class={cls}>Hi!</hi>
```
