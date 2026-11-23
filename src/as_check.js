// `as T` renders a value as T or fails. This pass runs last in validate and turns
// every `as` that the compiler can't settle into an `AsExpr`, which each backend
// emits as a call to its `as` runtime. It also adds that check to typed binds of
// remote replies, whose docs are only claims. See notes/session-2026-11-01-as-renders-or-fails.md.
import { inferType } from './type_infer.js';
import { members, isUnion, isList, listElement, isFn, isInstance, ownPath, show } from './type_enc.js';
import { buildTypeTable } from './codegen/type_table.js';

// Types here are encoded (src/type_enc.js). A node this pass makes carries a type
// both ways: its text, for the code generators, and its encoding (`…Enc`).

const SCALARS = new Set(['Integer', 'Text', 'Boolean', 'Float', 'Decimal', 'Blob']);
const NUMBERS = new Set(['Integer', 'Float', 'Decimal']);
const RENDERS = {
  Integer: NUMBERS, Float: NUMBERS, Decimal: NUMBERS,
  Text: new Set(['Text', 'Blob']), Blob: new Set(['Text', 'Blob']),
  Boolean: new Set(['Boolean']), null: new Set(['null']),
};
const CALLS = new Set(['FunctionCallExpr', 'DotCallExpr', 'DotAccessExpr', 'IfExpr', 'CatchExpr']);

// What the runtime checks against: a scalar's name, { u } for a union, { l } for
// a list, { t, f } for a Type. Null when there's nothing to check: a class has no
// shape, and a function type or a name this file doesn't declare can't be judged.
// `typeDecls` is keyed by a type's address, its encoding.
export function asDescriptor(t, typeDecls, seen = new Set()) {
  if (t === undefined || isFn(t)) return null;
  if (isUnion(t)) {
    const us = t['%or'].map(m => asDescriptor(m, typeDecls, seen));
    return us.includes(null) ? null : { u: us };
  }
  if (t === null) return 'null';
  if (SCALARS.has(t)) return t;
  if (isList(t)) {
    const element = listElement(t);
    return { l: element === 'Anything' ? null : asDescriptor(element, typeDecls, seen) };
  }
  const decl = typeDecls.get(t);
  if (!decl || seen.has(t)) return null;
  const inner = new Set(seen).add(t);
  return { t: decl.key ?? decl.name, f: (decl.fields || []).map(f => [f.name, asDescriptor(f.paramTypeEnc, typeDecls, inner), !!f.optional]) };
}

// Whether a type says anything: neither unknown nor holding `Anything`.
const mentionsAnything = (t) => t === 'Anything' || (Array.isArray(t) ? t.some(mentionsAnything)
  : t && typeof t === 'object' ? Object.values(t).some(mentionsAnything) : false);
const known = (s) => s !== undefined && !mentionsAnything(s);

function covers(t, s) {
  if (!known(s)) return false;
  const want = members(t);
  return members(s).every(m => want.includes(m));
}

const rendersAs = (s) => RENDERS[s === null ? 'null' : s];

function checkRenderable(t, s, expr, typeDecls) {
  if (!known(s) || isUnion(s)) return;
  const want = members(t);
  const list = isList(s);
  const judgeable = (m) => SCALARS.has(m) || m === null || typeDecls.has(m);
  if (!want.every(judgeable) && !(list && want.every(m => SCALARS.has(m)))) return;
  const renders = (m) => {
    if (typeof s === 'string' || s === null) {
      if (rendersAs(s)) return rendersAs(s).has(m === null ? 'null' : m);
    }
    if (list) return false;
    return typeDecls.has(s) ? typeDecls.has(m) : true;
  };
  const fractional = (expr?.type === 'FloatLiteral' || expr?.type === 'DecimalLiteral')
    && Number(expr.value) % 1 !== 0 && want.length === 1 && want[0] === 'Integer';
  if (fractional || !want.some(renders)) {
    throw new Error(`Cannot render ${show(s)} as ${show(t)} — no such rendering, so this 'as' can only fail`);
  }
}

// `x as { iface }` and `x as (params) -> *{ iface }` render x as an actor: a
// value (a scalar, a list, a Type) has no such rendering.
function checkActorRenderable(s, typeDecls) {
  const t = inferType(s.ref, new Map());
  if (!known(t)) return;
  const value = (m) => SCALARS.has(m) || m === null || isList(m) || typeDecls.has(m);
  if (members(t).every(value)) {
    throw new Error(`Cannot render ${show(t)} as an actor — no such rendering, so this 'as' can only fail`);
  }
}

export function lowerAs(ast) {
  const typeDecls = new Map([...buildTypeTable(ast).values()].map(e => [e.key, e]));
  // A class of this file, as a type: an instance of it.
  const ownInstance = (t) => isInstance(t) && !!ownPath(t);
  for (const a of ast.actors || []) {
    for (const s of a.constructorBody || []) if (s.type === 'ServiceCoercion') checkActorRenderable(s, typeDecls);
  }
  const classes = new Set((ast.actors || []).filter(a => a.name).map(a => a.name));
  const deps = new Set((ast.dependencies || []).filter(d => d.type !== 'FileParam').map(d => d.name));
  const members_ = new Set((ast.dependencies || []).flatMap(d => (d.destructures || []).map(m => m.local || m.alias || m.name || m)));
  const actorish = new Set();
  const localChildren = new Set();
  let seq = 0;

  const isCtorCall = (e) => e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier'
    && (classes.has(e.callee.name) || deps.has(e.callee.name) || e.callee.name === 'class');
  const isActorSource = (e) => isCtorCall(e) || (e?.type === 'Identifier' && (deps.has(e.name) || actorish.has(e.name)));
  const isRemoteCall = (e) => e?.type === 'DotCallExpr' || e?.type === 'DotAccessExpr'
    || (e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && members_.has(e.callee.name));

  const collectActors = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collectActors); return; }
    if ((node.type === 'Assign' || node.type === 'TypedAssign' || node.type === 'RefDecl') && node.name && isCtorCall(node.value)) actorish.add(node.name);
    if (node.type === 'TypedAssign' && ownInstance(node.typeNameEnc)) actorish.add(node.name);
    if (node.name && node.value?.type === 'FunctionCallExpr' && (classes.has(node.value.callee?.name) || node.value.callee?.name === 'class')) localChildren.add(node.name);
    if (node.name && ownInstance(node.typeNameEnc)) localChildren.add(node.name);
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') collectActors(v);
  };

  // A type both ways: `{ text, enc }`.
  const asExpr = (expr, t, desc) => ({ type: 'AsExpr', expr, typeName: t.text, typeNameEnc: t.enc, desc });
  const typedAssign = (name, t, value) => ({ type: 'TypedAssign', name, typeName: t.text, typeNameEnc: t.enc, value });
  const OBJECT = { text: 'Object', enc: 'Object' };
  const raw = (name) => `asraw${++seq}_${name}`;

  // The check a value needs against t: null when it's settled at compile time.
  const descFor = (t, expr, env) => {
    if (t === undefined || t === 'Object' || t === 'Anything') return null;
    const desc = asDescriptor(t, typeDecls);
    if (desc === null) return null;
    if (isActorSource(expr)) return desc;
    const s = inferType(expr, env);
    if (!isRemoteCall(expr)) checkRenderable(t, s, expr, typeDecls);
    return covers(t, s) && !isRemoteCall(expr) ? null : desc;
  };

  // A Type can come back as the whole reply (`return x: 1, y: 2`), so its check
  // reads every field; an actor still has to be asked for T.
  const onLocalChild = (e) => e?.object && (e.object.type === 'FunctionCallExpr' ? classes.has(e.object.callee?.name) : localChildren.has(e.object.name));
  const rawType = (t, desc, expr) => (desc?.t && isRemoteCall(expr) && !onLocalChild(expr) ? OBJECT : t);

  // An `as` on a value in statement position: anything that needs a typed bind's
  // machinery (a call, an actor) binds first, then the check reads the local.
  const checked = (expr, t, desc, pre) => {
    if (!CALLS.has(expr.type) && !isActorSource(expr)) return asExpr(expr, t, desc);
    const name = raw('v');
    pre.push(typedAssign(name, rawType(t, desc, expr), expr));
    return asExpr({ type: 'Identifier', name }, t, desc);
  };

  // A call on an actor has to wait for its reply, which only a bind does. A sole
  // call forwards the whole reply, so `return b.m()` means `r = b.m() as Object; return r`.
  const actorRef = (o) => (o?.type === 'Identifier' || o?.type === 'RefRead')
    && (deps.has(o.name) || actorish.has(o.name) || localChildren.has(o.name));
  const onActor = (e) => (e?.type === 'DotCallExpr' || e?.type === 'DotAccessExpr')
    && (isCtorCall(e.object) || actorRef(e.object) || onActor(e.object));
  const isMemberCall = (e) => e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && members_.has(e.callee.name);
  // Nothing says what an untyped param holds, so a call on it may be a call on an actor.
  // A param typed as a class, here or in another file, certainly is.
  const onUntyped = (e, env) => {
    if (e?.type !== 'DotCallExpr' || e.object?.type !== 'Identifier' || !env.has(e.object.name)) return false;
    const t = env.get(e.object.name);
    return t === undefined || t === 'Anything' || isInstance(t) || ast.remoteClassNames?.has(t);
  };

  // Not in a lambda: its body returns through the call that runs it.
  let lambdaDepth = 0;

  const bindActorCalls = (fields, env, pre) => {
    if (lambdaDepth > 0) return;
    for (const f of fields) {
      const source = f.expr ?? f.value;
      if (f.type || f.spread || f.selfReturn || !(onActor(source) || isMemberCall(source) || onUntyped(source, env))) continue;
      const whole = fields.length === 1 && f.expr && source.type !== 'DotAccessExpr' && !source.method?.endsWith('!');
      const name = raw('r');
      pre.push(whole ? typedAssign(name, OBJECT, source) : { type: 'Assign', name, value: source });
      env.set(name, whole ? 'Object' : undefined);
      if (whole) {
        delete f.expr;
        delete f.positional;
        delete f.typeEnc;
        Object.assign(f, { spread: true, name, type: null, localObject: true });
      } else if (f.expr) f.expr = { type: 'Identifier', name };
      else f.value = { type: 'Identifier', name };
    }
  };

  // A tail call on an actor is a return, so it binds like one.
  const returnTailCall = (fn) => {
    if (lambdaDepth > 0) return;
    const last = fn.body[fn.body.length - 1];
    const expr = last?.type === 'ExprStatement' || (last?.type === 'ImplicitReturn' && !last.typeName) ? last.expr : null;
    if (!expr || !(onActor(expr) || isMemberCall(expr)) || expr.silent || expr.method?.endsWith('.')) return;
    if (fn.body.some(s => s.type === 'SilentTerminator' || s.type === 'Reply')) return;
    fn.body[fn.body.length - 1] = { type: 'Reply', fields: [{ positional: true, expr, type: null }] };
  };

  const lowerField = (f, env, pre) => {
    if (f.selfReturn || f.spread || !f.type) return;
    const source = f.expr ?? f.value ?? (f.name ? { type: 'Identifier', name: f.name }
      : f.sigil ? { type: f.ref ? 'RefRead' : 'Identifier', name: f.sigil } : null);
    if (!source || source.type === 'StateVar') return;
    if (f.typeEnc === 'Object' && SCALARS.has(inferType(source, env))) { f.type = null; delete f.typeEnc; return; }
    const desc = descFor(f.typeEnc, source, env);
    if (desc === null) return;
    const value = checked(source, { text: f.type, enc: f.typeEnc }, desc, pre);
    if (f.value !== undefined) f.value = value;
    else if (f.sigil) { f.key = f.sigil; f.value = value; delete f.sigil; delete f.ref; }
    else { f.expr = value; delete f.name; }
  };

  const bindScope = (s, env) => {
    if (s.type === 'TypedAssign' || s.type === 'RefDecl') env.set(s.name, s.typeNameEnc);
    else if (s.type === 'Assign') env.set(s.name, inferType(s.value, env));
  };

  const lowerTypedBind = (s, env, out) => {
    const t = { text: s.typeName, enc: s.typeNameEnc };
    const claimed = !!s.value?.attestedAs;
    const remote = isRemoteCall(s.value) || isActorSource(s.value);
    if (s.value && t.enc === 'Object' && claimed && SCALARS.has(inferType(s.value, env))) {
      s.value = { type: 'ObjectConstructor', args: [{ positional: true, expr: s.value, type: null }] };
    }
    if (!s.value || !(claimed || remote)) { out.push(s); return; }
    const desc = descFor(t.enc, s.value, env);
    if (desc === null) { out.push(s); return; }
    if (!CALLS.has(s.value.type) && !isActorSource(s.value)) {
      s.value = asExpr(s.value, t, desc);
      out.push(s);
      return;
    }
    const name = raw(s.name);
    if (s.type === 'RefDecl') {
      out.push(typedAssign(name, rawType(t, desc, s.value), s.value));
      s.value = asExpr({ type: 'Identifier', name }, t, desc);
      out.push(s);
      return;
    }
    const held = rawType(t, desc, s.value);
    out.push({ ...s, name, typeName: held.text, typeNameEnc: held.enc });
    out.push(typedAssign(s.name, t, asExpr({ type: 'Identifier', name }, t, desc)));
  };

  const lowerDestructure = (s, out) => {
    out.push(s);
    if (!isRemoteCall(s.source)) return;
    for (const item of s.pattern || []) {
      const desc = item.type && !item.discard && item.typeEnc !== 'Object' ? asDescriptor(item.typeEnc, typeDecls) : null;
      if (desc === null) continue;
      const name = raw(item.name);
      const t = { text: item.type, enc: item.typeEnc };
      out.push(typedAssign(item.name, t, asExpr({ type: 'Identifier', name }, t, desc)));
      if (item.named) { item.key = item.name; delete item.named; }
      item.name = name;
    }
  };

  const lowerStatement = (s, env, out) => {
    if (s.type === 'TypedAssign' || s.type === 'RefDecl') {
      visit(s.value, env);
      lowerTypedBind(s, env, out);
      bindScope(s, env);
      return;
    }
    if (s.type === 'DestructureAssign') {
      visit(s.source, env);
      lowerDestructure(s, out);
      for (const item of s.pattern || []) if (item.name) env.set(item.name, item.typeEnc);
      return;
    }
    if (s.type === 'Reply' || s.type === 'Return') {
      for (const f of s.fields || []) {
        visit(f.expr ?? f.value, env);
        lowerField(f, env, out);
      }
      bindActorCalls(s.fields || [], env, out);
      out.push(s);
      return;
    }
    if (s.type === 'ImplicitReturn' && s.typeName && s.expr) {
      visit(s.expr, env);
      if (s.typeNameEnc === 'Object' && SCALARS.has(inferType(s.expr, env))) { s.typeName = null; delete s.typeNameEnc; }
      const desc = descFor(s.typeNameEnc, s.expr, env);
      if (desc !== null) s.expr = checked(s.expr, { text: s.typeName, enc: s.typeNameEnc }, desc, out);
      out.push(s);
      return;
    }
    visit(s, env);
    bindScope(s, env);
    out.push(s);
  };

  const lowerList = (list, env) => {
    const out = [];
    for (const s of list) {
      if (s && typeof s === 'object' && !Array.isArray(s)) lowerStatement(s, env, out);
      else out.push(s);
    }
    list.splice(0, list.length, ...out);
  };

  // An `as` inside an expression has nowhere to hoist to, so it wraps in place.
  const wrapInPlace = (holder, key, t, env) => {
    if (t.enc === 'Object' || !holder[key]) return;
    const desc = descFor(t.enc, holder[key], env);
    if (desc !== null) holder[key] = asExpr(holder[key], t, desc);
  };

  // A public handler's typed params come from another actor, whose tags are only
  // claims, so each is checked on arrival.
  const checkParams = (fn) => {
    const leading = fn.body.findIndex(s => s.type !== 'BareTypeDecl');
    const at = leading === -1 ? fn.body.length : leading;
    const params = [...fn.params, ...fn.body.slice(0, at).map(s => ({ name: s.name, type: s.typeName, typeEnc: s.typeNameEnc }))];
    const assigned = new Set(fn.body.filter(s => s.type === 'Assign' || s.type === 'TypedAssign').map(s => s.name));
    const checks = [];
    for (const p of params) {
      if (!p?.name || p.rest || p.defaultValue || assigned.has(p.name) || p.typeEnc === undefined || p.typeEnc === 'Object') continue;
      const desc = asDescriptor(p.typeEnc, typeDecls);
      if (desc !== null) checks.push({ type: 'ExprStatement', expr: asExpr({ type: 'Identifier', name: p.name }, { text: p.type, enc: p.typeEnc }, desc) });
    }
    // Never last: a trailing bare expression would become the reply.
    if (at < fn.body.length) fn.body.splice(at, 0, ...checks);
  };

  function visit(node, env) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.some(n => n && typeof n === 'object' && STATEMENTS.has(n.type))) lowerList(node, env);
      else node.forEach(n => visit(n, env));
      return;
    }
    if (node.type === 'AsExpr') return;
    if (Array.isArray(node.params) && Array.isArray(node.body)) {
      const inner = new Map(env);
      for (const p of node.params) if (p?.name) inner.set(p.key || p.name, p.typeEnc);
      if (node.type === 'Function') lambdaDepth++;
      returnTailCall(node);
      lowerList(node.body, inner);
      if (node.type === 'Function') lambdaDepth--;
      if (typeof node.name === 'string' && node.name.startsWith('@') && !node.name.startsWith('@@')) checkParams(node);
      if (node.expr) visit(node.expr, inner);
      return;
    }
    if (node.type === 'ObjectLiteral' || node.type === 'ObjectConstructor') {
      for (const a of node.args || []) {
        visit(a.expr, env);
        if (a.type && a.expr) wrapInPlace(a, 'expr', { text: a.type, enc: a.typeEnc }, env);
      }
      return;
    }
    if (node.type === 'DotCallExpr' || node.type === 'FunctionCallExpr') {
      visit(node.callee ?? node.object, env);
      for (const a of node.args || []) {
        if (a.expr) {
          visit(a.expr, env);
          if (a.typeName) wrapInPlace(a, 'expr', { text: a.typeName, enc: a.typeNameEnc }, env);
        } else visit(a, env);
      }
      return;
    }
    if (node.type === 'IfBranch' || (node.expr && node.typeName && !STATEMENTS.has(node.type))) {
      visit(node.expr, env);
      if (node.body) visit(node.body, new Map(env));
      if (node.expr && node.typeName) wrapInPlace(node, 'expr', { text: node.typeName, enc: node.typeNameEnc }, env);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' || !v || typeof v !== 'object') continue;
      visit(v, BLOCKS.has(k) ? new Map(env) : env);
    }
  }

  // What a constructor block runs is its initBody, whose cells store the value in
  // place. A cell set from a call to the actor's own function, or to one of an actor
  // it's declared in, holds the reply's one value. In a class, a failed `as` fails the construction. The file's own block
  // gets no `as` lowering: nothing has a call open on it to report to.
  const lowerConstructorBlock = (actor) => {
    const env = new Map((actor.initParams || []).filter(p => p?.name).map(p => [p.name, p.typeEnc]));
    const ownFns = new Set((actor.functions || []).map(f => f.name));
    for (const s of actor.initBody || []) {
      if (s.type !== 'StateAssign') continue;
      const decl = (actor.stateVarDecls || []).find(d => d.name === s.name);
      if (s.value?.type === 'FunctionCallExpr' && (ownFns.has(s.value.callee?.name) || s.value.outerFnCall) && decl?.typeNameEnc !== 'Object') s.soleValue = true;
      if (actor.name && s.value?.attestedAs) wrapInPlace(s, 'value', { text: s.value.attestedAs, enc: s.value.attestedAsEnc }, env);
      env.set(s.name, decl?.typeNameEnc);
    }
  };

  collectActors(ast.actors);
  visit(ast.actors, new Map());
  for (const actor of ast.actors || []) lowerConstructorBlock(actor);
}

const BLOCKS = new Set(['body', 'then', 'else', 'thenBranch', 'elseBranch']);
const STATEMENTS = new Set([
  'Assign', 'TypedAssign', 'RefDecl', 'DestructureAssign', 'Reply', 'Return', 'ImplicitReturn',
  'ExprStatement', 'ListDestructure', 'StateAssign', 'LaunchStatement', 'BareTypeDecl',
]);
