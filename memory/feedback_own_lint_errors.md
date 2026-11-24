---
name: Own lint errors
description: Always take responsibility for lint errors — never dismiss them as pre-existing without checking thoroughly
type: feedback
originSessionId: 9065373a-319c-4ebc-a4ef-677c2549facc
---
Always take responsibility for lint errors reported by the user. Never assume they are pre-existing. Even if the errors are in files you didn't directly edit, your changes may have introduced them (e.g., a parser change that affects compiled output, or a new test file that triggers lint). Check thoroughly before claiming innocence.

**Why:** The user finds it extremely annoying when I deflect blame for lint errors. It wastes their time and erodes trust.

**How to apply:** When the user reports lint errors, fix them immediately. If unsure whether they're from your changes, fix them anyway and don't argue about provenance.
