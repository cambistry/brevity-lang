# Design Notes Index

The `notes/` directory is a design journal for Brevity. It records decisions,
open questions, experiments, and implementation plans.

Use these notes as context, not as final specification. For current public
orientation, start with:

- [README](../README.md)
- [CAM](./CAM.md)
- [Language Overview](../LANGUAGE_OVERVIEW.md)
- [Usage](../USAGE.md)

## CAM and System Model

- [Evaluation: optimistic path](../notes/evaluation-optimistic-path-2026-03-28.md)
- [Evaluation: Brevity vs other stacks](../notes/evaluation-brevity-vs-other-stacks-2026-03-28.md)
- [View and remote actors](../notes/view-and-remote-actors-2026-03-24.md)
- [Binding model](../notes/binding-model-2026-03-24.md)
- [Actor as constructor](../notes/actor-as-constructor-2026-04-10.md)
- [Self becomes](../notes/self-becomes-2026-04-14.md)

## Messaging, Wire, and Interop

- [API usage](../notes/api-usage-2026-03-29.md)
- [Compilation targets](../notes/compilation-targets-2026-03-31.md)
- [Emit and subscribe](../notes/emit-subscribe-2026-03-26.md)
- [Subscription via multiple replies](../notes/subscription-via-multi-re-2026-04-18.md)
- [Address delimiter change plan](../notes/address-delimiter-change-plan-2026-04-23.md)
- [Multi-actor test harness](../notes/multi-actor-test-harness-2026-04-20.md)

## Language Shape

- [Constructors](../notes/constructors-2026-03-24.md)
- [Asterisk references](../notes/asterisk-references-2026-03-30.md)
- [Implicit return is projection](../notes/implicit-return-is-projection-2026-04-10.md)
- [Implicit return refinements](../notes/implicit-return-refinements-2026-04-14.md)
- [Backticks as dynamic names](../notes/backticks-as-dynamic-names-2026-04-16.md)
- [Identifier namespaces pass 1](../notes/identifier-namespaces-pass1-2026-04-28.md)
- [Type/class split](../notes/type-class-split-2026-04-25.md)
- [Types implementation plan](../notes/types-implementation-plan-2026-04-27.md)

## Browser and DOM Work

- [Browser target](../notes/browser-target-2026-04-01.md)
- [DOM as actor subsystem](../notes/dom-as-actor-subsystem-2026-04-13.md)
- [DOM browser namespaces](../notes/dom-browser-namespaces-2026-04-18.md)
- [Reactive closures](../notes/reactive-closures-2026-04-13.md)
- [Reactive DOM lifecycle](../notes/reactive-dom-lifecycle-2026-04-13.md)
- [Template type](../notes/template-type-2026-04-10.md)
- [Template static subtree inlining](../notes/template-static-subtree-inlining-2026-04-22.md)
- [HTML deferred](../notes/html-deferred-2026-04-26.md)
- [HTML remaining](../notes/html-remaining-2026-04-26.md)

## Implementation Sessions

- [Session 2026-03-04](../notes/session-2026-03-04.md)
- [Session 2026-03-05](../notes/session-2026-03-05.md)
- [Session 2026-03-07](../notes/session-2026-03-07.md)
- [Session 2026-03-15](../notes/session-2026-03-15.md)
- [Session 2026-03-20](../notes/session-2026-03-20.md)
- [Session 2026-04-20](../notes/session-2026-04-20.md)
- [Session 2026-04-23](../notes/session-2026-04-23.md)
- [Session 2026-04-23 structured children](../notes/session-2026-04-23-structured-children.md)
- [Session 2026-04-27](../notes/session-2026-04-27.md)

## Maintenance

When adding a note, add it here if it is useful for future readers. Keep highly
temporary scratch notes out of the public path unless they explain a decision
that still matters.
