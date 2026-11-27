// A lambda that's a value is reached by its `@N` selector (`#<:@N>`). A closure the
// front end lifts into an actor function is named `@N` too (src/extract_passes.js
// assignClosureAddresses), so a lambda's number skips those already taken.

let reserved = new Set();

// The `@N` names this program's actors already define. Set once per compile.
export function reserveClosureSelectors(ast) {
  reserved = new Set();
  for (const a of ast.actors || []) for (const f of a.functions || []) if (/^@\d+$/.test(f.name)) reserved.add(f.name);
}

// The next lambda number from `ctx.lambdaCounter`, past any taken `@N`.
export function nextLambdaNumber(ctx) {
  let n;
  do { n = ctx.lambdaCounter++; } while (reserved.has('@' + n));
  return n;
}
