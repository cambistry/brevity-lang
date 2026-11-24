---
status: inbox
created: 2026-11-19
---
# eliminate need for the noop hack

An actor should certainly be valid if it has any public interface, such as an actor-cell (@pub *Integer…).

And it should also be valid even if it only has protected names, since it can, theoretically, be subclassed and these become accessible by the subclass.

An actor with nothing but private names seems like a compilation error, even if its construction, or especially if its construction, creates one-time side effects. That is simply one-time execution.
