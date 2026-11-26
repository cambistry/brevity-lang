---
created: 2026-04-17
---
# redesign op:new payload

Currently we are relying on the “from” field to return the instantiated address of a constructor instance (actor). The problem is that this is inaccurate and confusing, and possibly claims an informational channel that will need to be leveraged in a different way in the future. It also forced us to invent the `self<type>` syntax that feels fragile, at best.

The reason for jumping through hoops is because the “from” and “to” fields have the property of being relative to a receiver’s (technically, child’s) coordinates, so that the new object becomes addressable by the receiver.

The better solution would be to fold the instantiation address into the “re” field, since the new process is what is being returned. But “re” and “bv-a” do _not_, so far, have the property of shifting according to receiver coordinates.

We have now developed the language construction of backticks, in relation to addresses. In the context of addressing, they mean: not this _string_, but the _actor_ that this string addresses. So this can travel “on the wire”.

And it is not just the new process that needs dynamic addressing - SO DOES ITS TYPE (in bv-a).

Proposal: use backticks in re and bv-a, and perhaps arbitrary fields, to indicate that a string is an address and SHOULD be dynamically shifted (if needed) relative to the CHILD element in the message hop.

(Note: it needs to be relative to the child because a child may literally not know its own address, and would not be able to prefix its own location.)

```
{id: "123", op: "new", to: "/widgets"}
...
{id: "123", re: "`/widgets/widget/1`", bv-a: "`/widgets/widget`", from: "/widgets" }
```
