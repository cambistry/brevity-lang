import { selfAddress } from './codegen/wire_labels.js';

// An actor is a value: any declared actor (an actor with a `new`, a singleton, the
// file) named where a value goes is its address, `ActorValue`, typed
// `Actor` and tagged `*` on the wire. An actor a `new` built is tagged with its
// maker instead; that's the class relationship, the only one there is.
//
// An actor declared in the actor whose code names it is at `:C` under it, so that
// code writes it `#<:C>`. Code anywhere else can't always say where the declaring
// actor is relative to itself (an instance can't name its file actor), so an actor
// declared in the file actor is written by its absolute address, `#<c.bv:C>`, which
// needs the file's name. (`self`, the actor's own address, is `#<:>` anywhere.)
//
// A name bound to a declared actor (`k = C`) may stand for it statically:
// `k(args)` is `C(args)`, `k.x` is `C.x` and `k::x` is `C::x`, resolved at compile
// time. Held in a cell, or arriving as a param or a reply, it's an ordinary actor
// reference: `k(args)` is `$new` to it and `k.x` a message to it; `k::x` is an error.
// See notes/actors-not-classes-2026-11-18.md.

export const ACTOR_TYPE = 'Actor';

const BINDS = new Set(['Assign', 'TypedAssign']);
const FUNCTIONS = new Set(['Function', 'FunctionDecl']);
// Keys whose Identifier isn't a value read: what's called, messaged or qualified.
const NOT_VALUE_KEYS = new Set(['callee', 'object', 'receiver', 'target']);

const statementLists = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (node.some(s => s && typeof s === 'object' && typeof s.type === 'string')) visit(node);
    node.forEach(n => statementLists(n, visit));
    return;
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') statementLists(v, visit);
};

// The tag of an actor the class `name` built: its maker's address (`:C`, `:N` for
// the public `@N`, which is `N__pub` by codegen).
export const makerTag = (name) => selfAddress(name.endsWith('__pub') ? '@' + name.slice(0, -'__pub'.length) : name);

// What a param's type expects of an arg's tag: an actor a `new` built is tagged
// with its maker's address (`:C`); `Actor` and a constructor profile take any
// actor (`*`, which the targets' tag matchers read so). Anything else is matched
// as it's written. `actors` is the program's.
export function expectedTag(t, actors) {
  if (t === ACTOR_TYPE || isCtorProfile(t)) return '*';
  const cls = typeof t === 'string' && (actors || []).find(a => a.name === t && !a.singletonOf && !a.membersOf);
  return cls ? makerTag(t) : t;
}

// A `self` slot's tag: `:`, the actor's class, which its parent fills in; in the
// file actor, which no `new` built and no parent translates, `*`.
export const selfSlotTag = (actor) => (actor && actor.name ? ':' : '*');

// A constructor profile, `(…) -> *{ … }`: the type of an actor with a `new`.
export const isCtorProfile = (t) => typeof t === 'string' && /^\(.*\)\s*->\s*\*\{/s.test(t);

// A reference to an actor whose `new` may be asked for: `Actor`, a constructor
// profile, either held in a cell (`*Actor`).
export const isActorRefType = (t) => typeof t === 'string' && (t.replace(/^[*&]/, '') === ACTOR_TYPE || isCtorProfile(t.replace(/^[*&]/, '')));

// A type written where an actor's value is bound: `Actor`, an interface, or a
// constructor profile all take it. Any other name is one that actor built.
const takesDeclared = (t) => t === ACTOR_TYPE || /^\*?\{/.test(t) || isCtorProfile(t) || (/\bActor\b/.test(t) && /\|/.test(t));

export function lowerActorValues(actors, byName) {
  const isClass = (a) => a && a.name && !a.singletonOf && !a.membersOf && !/^new__/.test(a.name);
  const isSingleton = (a) => a && a.singletonOf && !a.membersOf;
  // The actor (by name, null for the file actor) whose code declares `a`.
  const declarerOf = (a) => {
    let at = isClass(a) ? ('home' in a ? a.home : a.enclosing) : a.enclosing;
    // A class block's actors are at the class's label, under where it's declared.
    while (at && byName.get(at)?.membersOf) {
      const m = byName.get(at);
      at = m.enclosing ?? null;
    }
    return at ?? null;
  };
  // Whether code in `actor` reaches names declared in `scope` (itself or one it's inside).
  const sees = (actor, scope) => {
    for (let at = actor; at; at = byName.get(at.enclosing ?? at.home)) {
      if ((at.name ?? null) === scope) return true;
      if (!at.enclosing && !at.home) return scope === null;
    }
    return scope === null;
  };
  const singletons = actors.filter(isSingleton);
  // The declared actor a name stands for in `actor`'s code, or null.
  const declared = (name, actor) => {
    if (typeof name !== 'string') return null;
    const c = byName.get(name);
    if (isClass(c)) return c;
    return singletons.find(s => s.singletonOf === name && sees(actor, declarerOf(s))) ?? null;
  };
  const labelOf = (d) => isClass(d) ? d.name : d.singletonOf;
  const valueOf = (d, actor) => {
    const at = declarerOf(d);
    const here = actor.membersOf ? declarerOf(actor) === at && !actor.name : (actor.name ?? null) === at;
    if (!here && at !== null) throw new Error(`'${shown(d)}' as a value: an actor declared inside another actor, named from inside a third, isn't supported yet`);
    return { type: 'ActorValue', name: labelOf(d), label: selfAddress(labelOf(d)), relative: here };
  };
  // `Self` (the internal name `class` takes in a factory file, and in a class): the
  // actor with the `new` that built the actor it's in, or the file.
  // Either way it's written by its absolute address.
  const selfOf = (actor) => {
    const cls = isClass(actor) ? actor : null;
    if (cls && declarerOf(cls) !== null) throw new Error(`'class' as a value in '${shown(cls)}': an actor declared inside another actor isn't supported yet`);
    return cls ? { type: 'ActorValue', name: cls.name, label: selfAddress(cls.name), relative: false }
      : { type: 'ActorValue', name: null, label: '', relative: false };
  };

  for (const actor of actors) {
    const cells = new Set((actor.stateVarDecls || []).map(d => d.name));
    const asValue = (expr, shadowed) => {
      if (expr?.type !== 'Identifier' && expr?.type !== 'RefRead') return null;
      if (shadowed.has(expr.name)) return null;
      if (expr.name === 'class' && expr.type === 'Identifier') return selfOf(actor);
      const d = declared(expr.name, actor);
      return d ? valueOf(d, actor) : null;
    };
    // A declared actor named where a value goes.
    const lowerValues = (node, shadowed) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const v = asValue(node[i], shadowed);
          if (v) node[i] = v; else lowerValues(node[i], shadowed);
        }
        return;
      }
      if (FUNCTIONS.has(node.type) && (node.params || []).length) {
        shadowed = new Set([...shadowed, ...node.params.map(p => p.name)]);
      }
      if (node.type === 'Reply' || node.type === 'Return') {
        for (const f of node.fields || []) {
          if (!f.expr && !f.value && f.name && !shadowed.has(f.name)) {
            const v = asValue({ type: 'Identifier', name: f.name }, shadowed);
            if (v) { f.expr = v; delete f.name; }
          }
        }
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'loc' || !v || typeof v !== 'object') continue;
        if (NOT_VALUE_KEYS.has(k)) {
          // A `Self` or actor called or messaged stays as it's written; its args don't.
          if (!(v.type === 'Identifier' || v.type === 'RefRead')) lowerValues(v, shadowed);
          continue;
        }
        const av = asValue(v, shadowed);
        if (av) node[k] = av; else lowerValues(v, shadowed);
      }
    };
    const roots = [actor.functions, actor.initBody, actor.constructorBody, actor.declarationReturn];
    roots.forEach(r => lowerValues(r, new Set()));
    for (const d of actor.stateVarDecls || []) {
      const v = asValue(d.value, new Set());
      if (v) d.value = v;
    }

    // A name bound to a declared actor stands for it statically; one in a cell doesn't.
    for (const root of roots) statementLists(root, (list) => {
      for (const s of list) {
        // `k = self` holds the actor's own address.
        if (s?.type === 'Assign' && s.value?.type === 'SelfValue' && !s.isRef) Object.assign(s, { type: 'TypedAssign', typeName: ACTOR_TYPE, typeNameEnc: ACTOR_TYPE });
        if (!BINDS.has(s?.type) || s.value?.type !== 'ActorValue' || s.isRef || cells.has(s.name)) continue;
        const written = shownName(s.value.name ?? 'class');
        if (s.type === 'TypedAssign' && !takesDeclared(s.typeName)) {
          throw new Error(`'${s.name} ${s.typeName} = ${written}': '${s.name} ${s.typeName}' takes an actor '${s.typeName}' built, and '${written}' itself isn't one — write '${s.name} Actor = ${written}'`);
        }
        if (s.type === 'Assign') Object.assign(s, { type: 'TypedAssign', typeName: ACTOR_TYPE, typeNameEnc: ACTOR_TYPE });
        if (s.value.name !== null) rename(list, s.name, s.value.name);
      }
    });

    // `k::x` with `k` a param, a cell or a binding to anything else: known only at runtime.
    const runtimeNames = new Set(cells);
    const collect = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(collect); return; }
      if (FUNCTIONS.has(n.type)) for (const p of n.params || []) runtimeNames.add(p.name);
      if ((n.type === 'Assign' || n.type === 'TypedAssign' || n.type === 'RefDecl') && n.value?.type !== 'ActorValue') runtimeNames.add(n.name);
      for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') collect(v);
    };
    roots.forEach(collect);
    for (const p of actor.initParams || []) runtimeNames.add(p.name);
    const checkQualified = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(checkQualified); return; }
      if (n.type === 'QualifiedMember' && n.object?.type === 'Identifier' && !declared(n.object.name, actor) && runtimeNames.has(n.object.name)) {
        throw new Error(`'${n.object.name}::${n.name}' — '::' needs the actor written where it's used; '${n.object.name}' is only known at runtime`);
      }
      for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') checkQualified(v);
    };
    roots.forEach(checkQualified);
  }
}

// `k(…)`, `k.x`, `k.x <- …` and `k::x` with `k` bound to the declared actor `to`.
function rename(list, from, to) {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    // A nested binding of the same name ends the alias there.
    if (FUNCTIONS.has(n.type) && (n.params || []).some(p => p.name === from)) return;
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === from) n.callee = { ...n.callee, name: to };
    if ((n.type === 'DotCallExpr' || n.type === 'DotAccessExpr') && n.object?.type === 'Identifier' && n.object.name === from) n.object = { ...n.object, name: to };
    if (n.type === 'ActorFieldSet' && n.objectName === from) n.objectName = to;
    if (n.type === 'QualifiedMember' && n.object?.name === from) n.object = { ...n.object, name: to, written: from };
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') visit(v);
  };
  let bound = false;
  for (const s of list) {
    if (BINDS.has(s?.type) && s.name === from) {
      if (bound && s.value?.type !== 'ActorValue') break;
      bound = true;
      continue;
    }
    if (bound) visit(s);
  }
}

const shownName = (name) => String(name).replace(/__pub$/, '').replace(/[!.]$/, '');
const shown = (a) => shownName(a.sourceName ?? a.singletonOf ?? a.name).replace(/^@/, '');
