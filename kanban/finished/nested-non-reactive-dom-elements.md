---
created: 2026-04-22
---
# nested non-reactive DOM elements

Consider:

```
<div class="abc"><p class="subject">Geometry</p><div>
```

Technically what _should_ happen, is that the template renderer calls DOM.p and gets its new address, then passes that address to DOM.div as a child. So <p> gets assigned an address (`DOM/23`, say).

However _after that_ the address entry is no longer needed. Unless the template captures a reference to it, that entry should be deleted from the DOM index table and garbage collected.

So the question is whether there is a principled way to avoid creating this unneeded reference in the first place. The logical solution is to pass construction off to the <div> element itself. Let’s consider how this interacts with reactive closures.

```
<div>{ @content }</div>
```

This passes the closure address to the DOM.div constructor so that it can subscribe - which is something a DOM.div knows how to do natively.

```
{ children: ["<<app.bv @0>>"] }
```

All good. We do need a DOM rep actor to handle the reactivity. It can stay, receiving subscription updates and, in turn, updating the actual DOM element. What about …

```
<div><p>{ @content }</p></div>
```

Here, both references probably earn their keep. The <div> rep is what is actually returned from this template. Need that reference, presumably. (Though maybe not permanently?)

The <p> needs to exist so that _it_ can subscribe to the closure.

How about…

```
<div>
  <h1>Title</h1>
  <p>{ @body }</p>
</div>
```

In this case, there is no reason for a handle to the <h1> to be synthesized. It can just live in the DOM and never be heard from again!

The <p> needs reactivity, so the template constructor would first call DOM.p with the closure address passed as a child, and get a synthetic address back from the DOM. But the question is what it passes in CAM to  DOM.div…

```
{
  children: [
    "<h1>Title</h1>",
    "<<DOM @p/10>>"
  ]
}
```

This seems cohesive. Within the call to DOM.div, it knows how to directly instantiate an actual DOM h1, as do other constructors.

This is distinguishable from text nodes because… XML!

So it comes down to techniques of parsing by the compiler, I think.
