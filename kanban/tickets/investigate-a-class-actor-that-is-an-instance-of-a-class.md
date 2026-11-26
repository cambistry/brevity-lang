---
status: investigation
created: 2026-11-26
---
# Investigate: a class actor that is an instance of a class

`class::` is meaningful only in an instance today: it reaches the instance's class block. A
class's singleton actor could itself be an instance of another class, and then it would have a
class of its own, and `class::` in a class block would mean that class.

Explore: how a class block declares the class it is an instance of, what `class::` and `:*`
(`self::class`) mean in it, and what that does to `$new`, the service document's `instance`
section, and delegation between class blocks.
