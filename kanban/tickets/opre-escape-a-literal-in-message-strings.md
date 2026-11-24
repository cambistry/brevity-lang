---
status: inbox
created: 2026-11-03
---
# Opre: escape a literal #< in message strings

A #<…> in a message string is always an address. A literal `#<` in text is sent as `\#<`, and a literal `\` as `\\`. Inside an address, a literal `>` is `\>`. The rule was designed on 2026-04-23 (notes/address-delimiter-change-plan-2026-04-23.md), but only the inside-address part exists (encAddr/unescAddr, JS only).

- Encode when a Text value goes on the wire, and decode when one comes off, on every target.
- Make every address rewrite skip an escaped `\#<`: #_publishInstance, runActors, browser rewriteLocalAddresses and translateOutbound, the DOM stripMatchingAlias, and the readers that test for a #< prefix.
- Tests: a Text reply containing #<@x> round-trips unchanged through one and two parents, on every target.
- Then a bare #<…> in re is unambiguously a reference, and the one-actor check could be just "re is #<…>", once replies that refer to an endpoint (*Integer) are designed.
