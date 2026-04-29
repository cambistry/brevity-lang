# Brevity Documentation

This directory is the public documentation index for Brevity.

Brevity is best read from the model outward:

1. [CAM: The Contextual Actor Model](./CAM.md)
2. [Language Overview](../LANGUAGE_OVERVIEW.md)
3. [Feature Index](../LANGUAGE_FEATURES.md)
4. [Usage and Host API](../USAGE.md)
5. [Design Notes Index](./NOTES.md)
6. [Public Release Checklist](./PUBLIC_RELEASE.md)

## Start Here

- [CAM](./CAM.md) explains the actor/message model Brevity is built around.
- [Language Overview](../LANGUAGE_OVERVIEW.md) explains the source-level shape:
  files as actors, public handlers, constructor context, and actor references.
- [Usage](../USAGE.md) shows how to call the compiler from JavaScript and how
  target runtimes exchange messages.

## Implemented Feature Notes

The feature notes are written alongside tests. They are useful when you want to
see how a language idea behaves in concrete cases.

- [CAM / Interop](../__tests__/cam/index.md)
- [Constructors](../__tests__/constructors/index.md)
- [Functions](../__tests__/functions/index.md)
- [Keywords](../__tests__/keywords/index.md)
- [Operators](../__tests__/operators/index.md)
- [Services](../__tests__/services/index.md)
- [Types and Shapes](../__tests__/types/index.md)
- [Core Types](../__tests__/core_types/index.md)
- [Core Type Methods](../__tests__/core_types/methods.md)
- [Browser Target](../__tests__/browser/index.md)
- [HTML / XML Surface](../__tests__/html/index.md)
- [Marshal / Lifecycle](../__tests__/marshal/index.md)

## Implementation Notes

- [Self-sends implementation](./self-sends-implementation.md)
- [Design notes archive](./NOTES.md)
- [Public release checklist](./PUBLIC_RELEASE.md)

## Reading Guidance

The top-level docs describe the public story. The `__tests__/` docs describe
implemented behavior. The `notes/` directory is a design journal: valuable, but
not all notes represent current syntax or settled semantics.
