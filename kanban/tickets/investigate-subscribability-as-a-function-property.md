---
status: inbox
created: 2026-11-23
---
# Investigate: subscribability as a function property

  Design: notes/subscribability-2026-11-23.md (proposal)

‌

  Rule: a function is subscribable if it reads at least one outside subscribable address (transitively), makes no writes, and no actor it makes escapes by return, write or 

  send. Subscriptions don't count as escaping. Open: for a fresh actor in the result, (a) forbid or (b) replace on replay.

‌

  Find and report (no changes yet):

- How Layer A decides today that a closure is reactive (\`f = { expr }\` binding, template holes), and which of those cases the rule would change.

- Whether the effects check (src/effects.js) and the service doc's \`writes\` already give what conditions 2 and 3 (write route) need, and what an escape analysis for the 

  return and send routes would add: where fresh actors are made, and where their addresses flow into results or outgoing call args.

- Where subscribability would go in the type encoding and the service doc (next to \`writes\`), and how transitive calls to remote functions would read it.

- Template holes that return elements (\`{ if show { X() } else { <p/> } }\`, list rendering): how they behave today, and what (a) and (b) would each take on the DOM 

  runtime. For (b), this depends on the frame release work in escaping-frames-2026-11-23.md.

‌

  Output: a gap list for the rule, a proposed encoding, and a recommendation between (a) and (b) with what each costs.
