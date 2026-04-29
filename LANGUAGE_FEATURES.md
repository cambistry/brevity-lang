# Language Features

This file indexes focused documentation for individual Brevity language
features.

Each entry links to a note that explains a feature in the context of the
language as a whole: what it does, why it exists, and how it composes with
other parts of Brevity.

The feature notes are developed alongside the test suite in `__tests__/`. That
keeps the documentation close to implemented behavior while still allowing the
notes themselves to stay explanatory rather than test-oriented.

## Test-Backed Index

- [All test-backed notes](__tests__/README.md)

## Constructors

- [Constructors Overview](__tests__/constructors/index.md)
- [Constructor Parameter Accessors](__tests__/constructors/accessors.md)
- [Constructor Ingest](__tests__/constructors/ingest.md)
- [File-Level Dependency Injection](__tests__/services/dependency_injection.md)

## Keywords

- [Keywords Overview](__tests__/keywords/index.md)
- [`ingest`](__tests__/keywords/ingest.md)
- [`over`](__tests__/keywords/over.md)
- [`reduce`](__tests__/keywords/reduce.md)
- [`self as`](__tests__/keywords/self_as.md)

## CAM / Interop

- [CAM / Interop Overview](__tests__/cam/index.md)
- [Remote Interop](__tests__/cam/interop.md)
- [Remote Instances](__tests__/cam/remote_instance.md)

## Functions

- [Functions Overview](__tests__/functions/index.md)
- [Function Returns](__tests__/functions/returns.md)
- [Silent Functions](__tests__/functions/silent.md)
- [Function Overloads](__tests__/functions/overload.md)
- [Function Subscriptions](__tests__/functions/subscribe.md)

## Types

- [Types and Shapes](__tests__/types/index.md)

## Core Types and Data

- [Core Types](__tests__/core_types/index.md)
- [Core Type Methods](__tests__/core_types/methods.md)
- [Text Methods](__tests__/core_types/text_methods.md)
- [List Methods](__tests__/core_types/list_methods.md)
- [Blob Methods](__tests__/core_types/blob_methods.md)
- [Literal Type Inference](__tests__/literals/index.md)
- [Values](__tests__/values/index.md)
- [Library](__tests__/library/index.md)

## Control Flow and Operators

- [Operators Overview](__tests__/operators/index.md)
- [`ref`](__tests__/operators/ref.md)

## Destructuring

- [Destructuring](__tests__/destructure/index.md)

## Services / Host API

- [Services Overview](__tests__/services/index.md)
- [`extract()`](__tests__/services/extract.md)

## Browser / HTML

- [Browser Target](__tests__/browser/index.md)
- [HTML / XML Surface](__tests__/html/index.md)
- [XML Surface](__tests__/xml/index.md)

## Marshal / Lifecycle

- [Marshal / Lifecycle](__tests__/marshal/index.md)
- [CAM Test Messages](__tests__/cam_test/index.md)

## Runtime / Errors / Syntax

- [Runtime](__tests__/runtime/index.md)
- [Exceptions and Errors](__tests__/exceptions/index.md)
- [Syntax](__tests__/syntax/index.md)
- [Compile API Smoke Tests](__tests__/compile/index.md)
- [Run Smoke Tests](__tests__/run/index.md)
