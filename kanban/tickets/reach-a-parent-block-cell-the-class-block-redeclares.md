---
created: 2026-11-26
---
# Reach a parent block's cell that the class's own block redeclares

From an actor of `T`, `class::base::count` (read or write) and `G::count` fail when `T`'s class
block redeclares `count`: "the class block of 'T' redeclares 'count', and reaching another
block's 'count' from an actor of 'T' isn't supported yet". That's the only case where
`class::base::count` differs from `class::count`. Without the redeclaration both name the one
inherited cell, which works, writes included (gaps-in-super-implementation).

Lower it as the block does for itself: `base::count` from `T`'s block is the parent block's.
An actor's `class::base::x` could go through its class block's `base::x`.
