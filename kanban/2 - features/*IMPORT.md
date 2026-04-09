Code import macro (vs. `uses`)

--- below is old thinking ---

Related:

What does it mean to use a Brevity type, if "types" are just actor definitions? Does it mean that you need to have the running code locally if the actor factory is remote? The interface should be sufficient.

So there is a hierarchy of types. Some just have accessors. Some have methods. The latter are less transportable.

Thought:

A type can share an identifier across files if it *only* includes shape.

If it has functions, then it is not shareable except by "import", and not by name.
