---
status: done
created: 2026-11-03
---
# A self-return replies like #new: the actor's address in re, its class in bv-a

**Summary**

When a function ends with return self (or a tail self), the caller should get the same reply as for #new. The actor's address goes in re and its class's address goes in bv-a:

```
{ re: '#<@Counter/1>', 'bv-a': '#<@Counter>' }
```

Today the reply is { re: {}, 'bv-a': '#<@Counter/1>' }: the value sits in bv-a and re is an empty placeholder. This gives #<…> in bv-a two meanings. In the reply to #new it means "re is an actor of this class." In a self-return it means "the value is this actor." Rust's reply decoding (rust/program.js:1758) already treats any bv-a that starts with #< and has no :: as the value.

**Design**

- **The child says "me" with a bare { re: '#<>' } and no bv-a.** An empty selector already means "the actor that's replying." The child can't name its own address or its class, so any tag would be a stand-in. Don't use #<Self>: a selector that starts with a word character is global, so it would read as an address called Self.
- **The bare form is deliberate.** A reply whose whole value is one actor is a bare address in re. That's the same group as the reply to #new and a handler returning bare Self. v1 allows self only as a lone return, so ['#<>'] doesn't come up. If self is later allowed beside other values (return self, 7 → re: ['#<>', 7]), positional tagging is a separate piece of work.
- **The parent names the actor.** The parent that made the child sees re: '#<>' and promotes it to the child's address. It also adds bv-a with the child's class address, since it made that actor and knows its class. The trigger is the marker in the reply, not the child's profile: the parent has to wait for the reply anyway to learn whether the call finished or failed (ex). The profile can still be used to check that the function was declared to return self.
- **Higher parents translate re and bv-a alike.** Only the first parent adds bv-a. Every parent above it translates both addresses through the hierarchy.
- **DOM elements:** the element host is the element's parent and replies with the same shape as its reply to #new: { re: '#<HTML @div/1>', 'bv-a': '#<HTML @div>' }.
- **Actors of a private class** (Box(), @Box(), a private class Box): bv-a is the class's label as the parent knows it (#<Box>, #<#Box>), even though outsiders can't send to it.

**What to change (all targets: JS, browser, Rust, Erlang)**

- The child's reply: emit { re: '#<>' } with no bv-a.
- JS: classes.js:259 (_bva_re = … "#<>"), expressions.js:1075, expressions.js:1353, preambles.js:623.
- The parent's translation: in every path that passes a child's reply on (out-of-process children and in-process ones), promote re: '#<>' and add bv-a with the class address.
- Rust: program.js:1724-1727 currently writes re: {} with bv-a set to the address.
- Erlang: the matching reply path.
- The caller: take the call's value from re, not bv-a. Update the #<> special cases at classes.js:1000, classes.js:1009 and classes.js:1014, the chaining paths (#childSendChain/#childSendRead in JS, src/chains.js for Rust and Erlang), and Rust's reply decoding at rust/program.js:1758-1762.
- The DOM runtime: every reply that currently says re: {}, 'bv-a': '#<' + addr + '>' (runtime.js:1050, 1080, 1086, 1160, 1166, 1257) becomes re: '#<' + addr + '>' with bv-a set to the element's class (#<HTML @div>).
- Code that recognizes a call to itself (it currently treats #<> as "me"): check that it reads re.

**Tests**

- Update the expected self-return shape everywhere, for example public_class_across_files.test.js:408 → { re: '#<@Counter/1>', 'bv-a': '#<@Counter>' }.
- New cases:
- a self-return through a nested parent, checking that re and bv-a are both translated at each level;
- a self-return from an actor of a private class;
- a self-return from a DOM element;
- a chain c.a!().b() where a! returns self.

**Notes**

- Update notes/mutation-suffix-2026-10-31.md:129-145 and notes/session-2026-10-31-mutation-suffix.md ("Wire"). Both record { id, re: {}, 'bv-a': '#<>' } and the reasoning that put the value in bv-a.
