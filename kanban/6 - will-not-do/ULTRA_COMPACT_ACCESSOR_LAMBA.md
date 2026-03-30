Can we have an ultra-compact function form:

@get = -> :x

Perhaps the arrow here is not necessary, because the destructure sigil means that this must be a return value.

Could be simply:

@get = :x

(But think seriously if this could cause any parser confusion. If not, should do it. BREVITY.)

Thinking...

get = :x : Integer

Could this mean:

get = Structure(:x : Integer)

which is expressible as the literal:

get = (:x : Integer)

Yeah. So get is a Structure with a named-value, x.

I guess that is what `@get = :x` would expose. Not exactly function -- a Structure with a named value. But it is returning a structure like any function does, under the hood.

The question is: is x evaluated at the time of declaration, or at invocation? And that distinction is critial.

I'm thinking that

@get = :x

Is defining a public constant: a function that always returns the value of x at the time of definition.

`@get = { :x }` on the other hand is defining a block (lambda). But wait. That is also going to destructure immediately if x is a local var. But if x is a ref:

ref x = Integer(1)
@get = { :x }

Somehow THIS need to defer evaluation. EEEEETERESTING.

And if that is possible, then should this be a synonym?

@get = :x

?

HMMMMMM.

My gut says yes, but my brain says no. Brain probably wins here. But need to think more.
