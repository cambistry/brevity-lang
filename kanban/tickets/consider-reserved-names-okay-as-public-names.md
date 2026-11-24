---
status: inbox
created: 2026-11-13
---
# Consider: reserved names okay as public names?

Technically there is not a conflict.

\@‌if

On the wire as an op or an address, this would show up as “if”.

In source, it would be written as \@‌if.

It’s “name” would be “if”.

I can’t think of a persuasive reason to prohibit. So the blast radius of a reserved word is to bare names, i.e. protected, internally and on the wire prefixed with ~.

I like that the internal constraints of BV do not, thereby, impact its flexibility in defining an external interface, which should just be keys, after all, however they are actually written.

Discuss.
