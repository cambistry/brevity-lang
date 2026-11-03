import { expectBehavior, compileSource } from "../helpers.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Lambda body forms, closures, and multi-call
// ═══════════════════════════════════════════════════════════════════════════════

describe("function — all forms", () => {
  const script = `
    --- curly-brace body (parens required) ---

    @curlyOne
      =
      fn = (a) { a + 1 }
      result Integer = fn(5)
      return :result

    @curlyTwo
      =
      fn = (a, b) { a + b }
      result Integer = fn(3, 4)
      return :result

    @curlyMult
      =
      fn = (a, b) { a * b }
      result Integer = fn(6, 7)
      return :result

    --- single-expr body, bare param (no parens) ---

    @bareExpr
      =
      fn = a -> a + 1
      result Integer = fn(10)
      return :result

    --- single-expr body, parens form ---

    @parenSingleExpr
      =
      fn = (a) -> a + 1
      result Integer = fn(10)
      return :result

    --- single-expr body, typed param requires parens ---

    @exprTyped
      =
      fn = (a Integer) -> a * 2
      result Integer = fn(7)
      return :result

    --- single-expr body, multiple params ---

    @exprTwo
      =
      fn = (a, b) -> a - b
      result Integer = fn(10, 3)
      return :result

    --- return type annotation ---

    @returnAnnotation
      =
      fn = (a, b) { a / b }
      result Float = fn(3.0e0, 2.0e0)
      return :result

    --- closures ---

    @closureRead
      =
      x Integer = 7
      fn = a -> a + x
      result Integer = fn(3)
      return :result

    @closureOwnName
      =
      x Integer = 10
      fn = {
        y Integer = 99
      }
      result Integer = fn()
      return :x, :result

    --- called multiple times ---

    @calledTwice
      =
      fn = (a) { a * a }
      x Integer = fn(3)
      y Integer = fn(5)
      return :x, :y

    @twoFunctions
      =
      double = a -> a * 2
      triple = a -> a * 3
      x Integer = double(4)
      y Integer = triple(4)
      return :x, :y
  `;

  it("(a) { a + 1 } — single positional, curly body", async () => {
    await expectBehavior(
      script,
      { input: { id: "1", op: "@curlyOne", from: "c" } },
      {
        output: {
          id: "1",
          "ty": { result: "Integer" },
          re: { result: 6 },
          to: "c",
        },
      },
    );
  });

  it("(a, b) { a + b } — two positionals, curly body", async () => {
    await expectBehavior(
      script,
      { input: { id: "2", op: "@curlyTwo", from: "c" } },
      {
        output: {
          id: "2",
          "ty": { result: "Integer" },
          re: { result: 7 },
          to: "c",
        },
      },
    );
  });

  it("(a, b) { a * b } — multiplication", async () => {
    await expectBehavior(
      script,
      { input: { id: "3", op: "@curlyMult", from: "c" } },
      {
        output: {
          id: "3",
          "ty": { result: "Integer" },
          re: { result: 42 },
          to: "c",
        },
      },
    );
  });

  it("a -> a + 1 — bare single param, expr body", async () => {
    await expectBehavior(
      script,
      { input: { id: "4", op: "@bareExpr", from: "c" } },
      {
        output: {
          id: "4",
          "ty": { result: "Integer" },
          re: { result: 11 },
          to: "c",
        },
      },
    );
  });

  it("(a) -> a + 1 — parens single param, expr body", async () => {
    await expectBehavior(
      script,
      { input: { id: "4b", op: "@parenSingleExpr", from: "c" } },
      {
        output: {
          id: "4b",
          "ty": { result: "Integer" },
          re: { result: 11 },
          to: "c",
        },
      },
    );
  });

  it("(a Integer) -> a * 2 — typed param requires parens", async () => {
    await expectBehavior(
      script,
      { input: { id: "5", op: "@exprTyped", from: "c" } },
      {
        output: {
          id: "5",
          "ty": { result: "Integer" },
          re: { result: 14 },
          to: "c",
        },
      },
    );
  });

  it("(a, b) -> a - b — two params, expr body", async () => {
    await expectBehavior(
      script,
      { input: { id: "6", op: "@exprTwo", from: "c" } },
      {
        output: {
          id: "6",
          "ty": { result: "Integer" },
          re: { result: 7 },
          to: "c",
        },
      },
    );
  });

  it("(a, b) { a / b } — return type annotation", async () => {
    await expectBehavior(
      script,
      { input: { id: "7", op: "@returnAnnotation", from: "c" } },
      {
        output: {
          id: "7",
          "ty": { result: "Float" },
          re: { result: 1.5 },
          to: "c",
        },
      },
    );
  });

  it("function reads outer-scope variable", async () => {
    await expectBehavior(
      script,
      { input: { id: "8", op: "@closureRead", from: "c" } },
      {
        output: {
          id: "8",
          "ty": { result: "Integer" },
          re: { result: 10 },
          to: "c",
        },
      },
    );
  });

  it("a function's own name leaves the outer variable unchanged", async () => {
    await expectBehavior(
      script,
      { input: { id: "9", op: "@closureOwnName", from: "c" } },
      {
        output: {
          id: "9",
          "ty": { x: "Integer", result: "Integer" },
          re: { x: 10, result: 99 },
          to: "c",
        },
      },
    );
  });

  it("same function called twice gives independent results", async () => {
    await expectBehavior(
      script,
      { input: { id: "10", op: "@calledTwice", from: "c" } },
      {
        output: {
          id: "10",
          "ty": { x: "Integer", y: "Integer" },
          re: { x: 9, y: 25 },
          to: "c",
        },
      },
    );
  });

  it("two distinct functions in same public function", async () => {
    await expectBehavior(
      script,
      { input: { id: "11", op: "@twoFunctions", from: "c" } },
      {
        output: {
          id: "11",
          "ty": { x: "Integer", y: "Integer" },
          re: { x: 8, y: 12 },
          to: "c",
        },
      },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe("function — compile errors", () => {
  it("plain assignment to outer-scope variable inside function → compile error", () => {
    expect(() =>
      compileSource(`
      @go
        =
        x Integer = 0
        fn = {
          x = 1
        }
        return :x
    `),
    ).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });
});
