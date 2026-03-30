Need tests, and maybe a syntax, for storing `ref` objects in actor $state variables.

Is it as simple as:

ref thing = Thing(...)
$thing = &thing

?

But... the state variable should have a type declaration, right? But... if it is not immediately populated...

Maybe that is the constraint right now:

ref $thing = Thing(...) // actually initialize it

And then interact with it in functions as a stateful object.

Alternatively:

ref $thing : Thing | null = null

If it can actually be absent.

Or it is a collection:

$things : List of Thing = []

Blahhh. Can't get my head around it.

----

I **think** that ref in front of a actor state variable declares an un-rebindable object.

$a = Thing(...) // $a is bound to the type Thing, but not necessarily *this* thing
ref $a = Thing(...) // this is the thing. no rebinding.
