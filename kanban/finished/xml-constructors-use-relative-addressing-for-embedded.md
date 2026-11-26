---
created: 2026-04-23
---
# XML constructors use relative addressing for embedded constructors

```
<DOM: (:div, :p) *>
-> <div><p>content</p></div>
```

At the moment, the inner content `<p>content</p>` is passed as a string literal for the DOM.div constructor to resolve. However that means that the DI of :p is meaningless here, and is entirely interpreted by DOM.div.

Instead, the constructor addresses should be resolved by this generator and passed over CAM:

```
<#<DOM @p>>content</<<DOM @p>>>
```

The first outer angle bracket might need to be escaped for clarification:

```
\<#<DOM @p>> ...
```

The address gets rewritten on delivery:

```
\<#<@p>> ...
```

And then resolved to local HTML tags.
