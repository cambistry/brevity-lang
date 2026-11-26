---
created: 2026-11-17
---
# <instance>::class

I like it. Unlike most overloads, it fits the rules you've already set.

**Why it works**

- **It can't be ambiguous.** class is reserved, so no member can be named class, and x::class can't collide with a type or a protected member. That's the same reasoning that keeps X::name unambiguous for types.
- **class becomes shorthand for self::class.** That makes the bare word read the way self does: an implicit receiver, not a separate concept. class_of can then retire completely, with no long form left over.
- **:: is better than . here.** . sends a message by wire name, so x.class would mean "ask x what its class is", and the actor would be answering for itself. :: means "a name in that actor's scope, as declared". An actor's class is a fact about its reference (its ty), not something it decides, and :: says that.
- **It chains.** x::class::total, x::class.count and x::class::Point all read left to right with no new rules.
- **There's precedent.** Kotlin uses x::class and String::class, and PHP uses Foo::class, both for nearly this meaning.

**Things to pin down**

- **The family rule needs an exception.** You've ruled that C::name is allowed only within C's family. x::class has to be allowed on any actor, because knowing what class something is is public information carried in ty. Then x::class::total would still be family-only, checked against the class it resolves to.
- **Static or runtime.** For self the class is known at compile time. For an arbitrary x it may only be known at runtime, from the ty tag (the open class_of(other) question). Decide whether x::class needs a statically known class, or is a runtime lookup that ends up compiling x::class::total to a dynamic dispatch.
- **Remote actors.** If x is remote, x::class is the address of a class living elsewhere. That connects to the open remote-superclass note, so it's probably fine to defer for anything other than self.
- **Where a class is the receiver.** C::class (the class of a class block) and class::class should probably be errors for now, matching "class inside a class block is an error".

The overloading is real but shallow: class always means "the class of something", and :: says whose.
