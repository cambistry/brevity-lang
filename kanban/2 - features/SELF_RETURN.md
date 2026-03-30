What does it meeeeeeeean???

Especially in relation to the set and update operations.

Do these always "return self"? And if so, what does that look like on the wire?

And what about user-declared bang operations. Always `self`? That a strong position.

Possible UNIVERSAL RULE:

If your op is destructive, Brevity returns `self`.

If you want something else as a result... chain off of the return.
