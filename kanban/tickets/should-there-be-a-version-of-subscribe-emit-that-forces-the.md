---
status: investigation
created: 2026-11-04
---
# should there be a version of subscribe/emit that forces the publisher to use a bang function?

Or _should_ emit already do that?

Bear in mind that this would only be relevant for functions that _change nothing locally or by other bang calls_.

It sounds like a job for “untracked”?
