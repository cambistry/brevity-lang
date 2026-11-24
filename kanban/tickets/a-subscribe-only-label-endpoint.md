---
status: investigation
created: 2026-11-19
---
# a subscribe-only label / endpoint

  Design: a subscribe-only label / endpoint

‌

  Replaces events as a separate mechanism (see the emit/on removal ticket). We need an address that answers only \`$subscribe\`: no \`$get\`, and no \`$set\` from outside. It 

  serves event-shaped channels such as clicks, notifications and lifecycle signals, where each occurrence matters and there is no "current value".

‌

  Working rules (from discussion, to confirm or refine):

- Verbs: \`$get\` unhandled; \`$set\` unhandled from outside; \`$subscribe\` yes. It's the mirror of the write-only cell (\`set label (Text)\`). Add it as a row in the verb table

  in notes/at-sigil-internal-and-quoted-names-2026-11-12.md.

- No initial \`re\`. A subscription starts at "now", and the first \`re\` is the next push. (Otherwise subscribe-then-drop works as a \`$get\`.) This is what separates it from 

  the function row, which also refuses \`$get\` but sends its current result first.

- Nothing is stored. With no \`$get\` and no initial \`re\`, a stored value can't be observed, so the runtime keeps none. In particular, no stale ephemeral endpoints 

  (\`HTML::Event\`'s prevent/stop) are retained.

- The owner can't read it either. The owner can only push.

- Pushing isn't a write: it changes nothing readable, so no \`!\` (keeps the 2026-11-03 "emit isn't a write" outcome).

- No conflation or dedupe, ever: every push reaches every subscriber, in order. Value cells stay free to batch later.

‌

  Open questions to settle:

1. Declaration spelling, in source and in the service document. A candidate parallel to \`set label (Text)\` is a verb-led entry like \`subscribe clicked (Event)\`. Check 

  existing forms and collisions before proposing anything new.

1. How the owner pushes. \`clicked <- e\` reads naturally, but \`<-\` is \`$set\`, which this address refuses from outside. Decide whether the owner's push is \`<-\` (with set 

  from inside allowed) or something else, and what the wire op is.

1. Subscriber side: confirm plain \`.subscribe (e) { … }\` works unchanged, including remotely (\`$subscribe\` to \`Remote clicked\`) and from a class subscribing to an 

  enclosing actor's label.

1. Reactive closures that capture the label: is that a subscription, a compile error, or something else? (A plain read is an error.)

1. Capabilities: how it combines with \`&\` / \`*\` params. Is there a "subscribe-only" grant, and does passing a \`&\` cell where a subscribe-only one is expected auto-coerce?

1. Delivery to slow or remote subscribers: is order per subscriber guaranteed, and is any backpressure needed?

1. Unsubscribe and lifetime: covered by whatever \`$subscribe\` already does, or does this need something?

‌

  Output: a design note in notes/ covering these points, with examples in both lineal and delimited forms. No implementation in this ticket.
