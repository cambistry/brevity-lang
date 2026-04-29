# Brevity Writing Pack

This folder is a source pack for AI-facing Brevity writing resources.

It is not meant to be the public language description. It is meant to be:

- compact
- conservative
- portable into Tensile app repos
- grounded in the currently tested language surface

The intended workflow is:

1. Maintain this pack in `brevity-lang`.
2. Periodically refresh it from the tests when the language changes.
3. Copy or link it into application repos that want agents to write Brevity.

The files here are deliberately narrower than the full language. They focus on
the subset an agent can use safely for current app work, especially demo work.

Contents:

- `SKILL.md`: operational instructions for an agent writing Brevity
- `references/compact-language-profile.md`: the smallest stable mental model
- `references/demo-safe-patterns.md`: tested idioms worth copying
