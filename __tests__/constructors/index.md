# Constructors

Constructors in Brevity define how actors come into being.

That sounds ordinary, but in Brevity the constructor boundary carries more
weight than it does in many languages. A constructor is not just setup code that
runs before the "real" actor begins. It is one of the places where the public
shape of the actor is decided.

## Constructors are actor definitions

A constructor introduces an actor type and the parameters needed to create an
instance of it.

```brevity
Greeter = <> {
  @hello = -> greeting: "hi" as Text
}
```

With parameters:

```brevity
Point = <x Integer, y Integer> {
  @sum = -> total: (x + y) as Integer
}
```

Those parameters are not only initialization values. They also define part of
the actor's interface to the rest of the program.

## The constructor boundary matters

One recurring theme in Brevity is that boundaries are explicit:

- the file boundary
- the public handler boundary
- the constructor boundary

Constructor parameters can become internal bindings, public accessors, injected
dependencies, or child actor references. That is why the constructor forms in
this directory matter so much: they are not just syntactic variations on
instantiation. They are ways of describing what an actor closes over and what
shape it exposes.

## Constructors are where composition happens

Many of the most important composition patterns in Brevity happen at
construction time.

Examples include:

- passing ordinary values into a new actor
- wrapping child actors with `*`
- declaring dependency boundaries for the file-actor
- deciding which constructor inputs are public, private, or remapped

This makes constructor design closer to API design than to mere object setup.

## Sugared and explicit forms

Brevity has both explicit constructor syntax and more compact sugared forms.

The sugared forms are not a separate feature with different semantics. They are
ways of writing the same underlying actor-construction ideas with less
boilerplate when the intent is already clear.

That is worth keeping in mind when reading these tests and notes: the language
is trying to keep the model small even when there are multiple surface forms.

## Constructors and actor references

One of the most characteristic constructor features is the use of `*` for actor
references.

```brevity
Wrapper = <inner *> {
  @quadruple = |n: Integer| {
    result: Integer = inner.double(n: n)
    -> result: (result * 2) as Integer
  }
}
```

This is a good example of how constructors in Brevity do real architectural
work. They are where actor relationships are declared, not hidden away in a
separate wiring system.

## Constructors are close to the language's type story

Because constructor parameters can be typed, remapped, hidden, or exposed,
constructor syntax ends up sitting close to the language's ideas about:

- identity
- interface
- encapsulation
- composition

That is why the constructor-related tests range from simple actor instantiation
to accessors, dependency injection, wrapped actors, and subtype behavior. They
are all exploring different consequences of the same central question:

What does it mean to create an actor with a particular boundary?

## Documents in this directory

- [Constructor Parameter Accessors](accessors.md)
- [File-Level Dependency Injection](dependency_injection.md)

More notes can be added alongside the individual test files as those features
stabilize.
