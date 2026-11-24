---
status: done
created: 2026-04-18
---
# Make DOM construction honest

```
<DOM: (:div) *> -> <div>Hello</div>
```

This should not be faked. A _REAL_ CAM call to the DOM.div constructor hosted by the DOM _service_.

{op: [{children: [“Hello”]}, “new”], to: “DOM.div”}

Unsure of the `to` address. But something like that!

Returning an address:

{re: “`DOM.div/1`", “bv-a”: “`DOM.div`“}
