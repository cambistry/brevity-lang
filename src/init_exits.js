// A bare `return` in a constructor block ends construction there; the result is still
// the actor (notes/constructor-tail-and-ingest-retired-2026-11-26.md). Each target
// already runs an `if` in a constructor block, so the exit is settled here: what
// follows an `if` with an exit moves onto its branches that don't exit, and what
// follows an exit goes. `[a, if c { x; return }, b]` is `[a, if c { x } else { b }]`.
//
// In a block that builds its base with `super`, every path builds it once, so an exit
// before the base is built is an error. This runs before `super` is lowered
// (src/super_calls.js): `if c { super(0); return }` then `super(1)` settles to an `if`
// with `super` on each branch.

const isIf = (s) => (s?.type === 'ExprStatement' || s?.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr';

// An `if`'s branches, each `else if` level's included; a missing `else` is null.
function branchesOf(ifExpr) {
  const out = [];
  for (let b = ifExpr; b; b = b.else?.type === 'IfExpr' ? b.else : null) {
    out.push(b.then);
    if (b.else?.type !== 'IfExpr') out.push(b.else ?? null);
  }
  return out;
}

// A branch's statements: its block, or its one-line expression.
const stmtsOf = (b) => b?.body ?? (b?.expr ? [{ type: 'ExprStatement', expr: b.expr }] : []);

const isSuper = (s) => (s?.type === 'ExprStatement' || s?.type === 'ImplicitReturn') && s.expr?.type === 'SuperCall';

const isExit = (s) => s?.type === 'Return' || s?.type === 'SilentTerminator';

function exits(list) {
  return (list || []).some(s => isExit(s) || (isIf(s) && branchesOf(s.expr).some(b => exits(stmtsOf(b)))));
}

// Fails on an exit with a value, or one before the base is built. `built` is whether
// the base is built on entry; the result, whether it is on every way out.
function check(A, list, built) {
  for (const s of list || []) {
    if (isExit(s)) {
      if (s.fields?.length) throw new Error("A constructor block returns no value: 'return' here stands alone");
      if (!built) throw new Error(`'return' in '${A.name}' leaves before 'super' builds the base`);
    }
    if (isSuper(s)) built = true;
    if (isIf(s)) {
      const after = branchesOf(s.expr).map(b => check(A, stmtsOf(b), built));
      built = built || after.every(Boolean);
    }
  }
  return built;
}

// The statements a path runs, with each exit settled.
function settle(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (isExit(s)) return out;
    if (!isIf(s) || !branchesOf(s.expr).some(b => exits(stmtsOf(b)))) { out.push(s); continue; }
    const rest = list.slice(i + 1);
    const ifExpr = structuredClone(s.expr);
    for (let b = ifExpr; b; b = b.else?.type === 'IfExpr' ? b.else : null) {
      const withRest = (br) => {
        const out = { ...(br ?? { type: 'IfBranch' }), body: settle([...stmtsOf(br), ...rest]) };
        delete out.expr;
        return out;
      };
      b.then = withRest(b.then);
      if (b.else?.type === 'IfExpr') continue;
      b.else = withRest(b.else);
    }
    out.push({ ...s, type: 'ExprStatement', expr: ifExpr });
    return out;
  }
  return out;
}

const hasSuper = (list) => (list || []).some(s => isSuper(s)
  || (isIf(s) && branchesOf(s.expr).some(b => hasSuper(stmtsOf(b)))));

export function settleInitExits(actors) {
  const clauses = actors.flatMap(a => (a.functions || []).filter(f => f.actorDef).map(f => f.actorDef));
  for (const A of [...actors, ...clauses]) {
    if (!exits(A.initBody)) continue;
    check(A, A.initBody, !hasSuper(A.initBody));
    A.initBody = settle(A.initBody);
  }
}
