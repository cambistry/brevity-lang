---
status: todo
created: 2026-04-17
---
# consider: should "self" return be expressed the same way as "new" return? Or similarly?

It feel technically correct but structurally unnecessary, since you already know what you are addressing. It is tempting to call all `->self` functions silent: however the caller may want a response in order to know that the operation is complete, even if not requesting the actual result.

Awaiting the response should probably be the normal expectation. But what does that response look like?

{ … re: “self”… } ?

{ … re: “#</object/address>” … } ?

The second is technically correct… but is it unnecessary overhead?

---

**Probably better to be correct. Fortunately, an object (are we calling it that?) can express its own address as #<> (or maybe #<self>) – it doesn’t need to know its own address. But does it know the address of its constructor/class? I don’t see why that shouldn’t be baked in as well. It should be able to reply with the (relative?) address of its constructor in the bv-a.**
