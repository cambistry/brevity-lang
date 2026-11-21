// Name resolution: every name in value position is bound, or it's an error,
// `'x' is not defined`. A name is bound by, innermost first:
//   - a block's locals: in text order, except a cell (`n *Integer = 0`), a local
//     function and a `use` binding, which are bound from the block's start
//   - a function's params (a subscribe callback's, a lambda's)
//   - its actor: params, cells, constants, functions, `use` bindings, inherited
//     ones too (notes/class-scope-and-inheritance-2026-11-16.md)
//   - the actors it's declared in, out to the file actor
//     (notes/private-names-lexical-2026-11-16.md)
//   - the program: classes, types, dependencies and what they destructure
//   - builtins: the namespaces and intrinsics
// A cell's address exists from its actor's start, so a read of it before its line
// is bound here; src/init_order.js reports it as read before its declaration
// (notes/forward-reads-in-constructor-blocks-2026-11-11.md).
//
// An unbound name whose `@` or `#` form, or silent form, is bound gets a message
// that names it.

import { resolveSuperclassChain } from './subclass.js';
import { noBaseParents } from './super_calls.js';
import { CLASS_SELF } from './singleton_classes.js';
import { TEXT_METHODS, BLOB_METHODS, GRAPHEME_TEXT_METHODS } from './text_methods.js';
import { LIST_METHODS } from './list_methods.js';
import { MATH_METHODS } from './math_methods.js';
import { BUILTIN_TYPE_NAMES } from './ast.js';

// The builtin namespaces and the methods each answers when called on the name
// itself: `Text.upper(t)`, `Math.sqrt(x)`, `Integer.to_text(n)`.
const NAMESPACE_METHODS = {
  Text: TEXT_METHODS, Blob: BLOB_METHODS, GraphemeText: GRAPHEME_TEXT_METHODS, List: LIST_METHODS,
  Math: MATH_METHODS, Integer: MATH_METHODS, Float: MATH_METHODS, Decimal: MATH_METHODS,
};
const INTRINSICS = [CLASS_SELF, '__tick__', 'Boolean', 'Object'];

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.kinds = new Map();
  }
  // What `name` is here: 'cell', 'function', 'class', 'namespace' or 'value';
  // undefined if unbound.
  kind(name) {
    for (let s = this; s; s = s.parent) if (s.kinds.has(name)) return s.kinds.get(name);
    return undefined;
  }
  add(kind, ...names) {
    for (const n of names) if (typeof n === 'string' && !this.kinds.has(n)) this.kinds.set(n, kind);
  }
}

// The names a destructure pattern binds.
function patternNames(pattern) {
  const names = [];
  const walk = (p) => {
    if (!p || typeof p !== 'object') return;
    if (Array.isArray(p)) { p.forEach(walk); return; }
    if (typeof p.name === 'string' && !p.discard) names.push(p.name);
    if (p.pattern) walk(p.pattern);
  };
  walk(pattern);
  return names;
}

// What a statement binds in the block it's in.
function bindsOf(s) {
  if (!s || typeof s !== 'object') return [];
  switch (s.type) {
    case 'RefDecl':
      return [['cell', s.name]];
    case 'Assign': case 'TypedAssign': case 'StateAssign': case 'BareTypeDecl': case 'ServiceCoercion':
      return [[s.isRef ? 'cell' : s.value?.type === 'Function' ? 'function' : 'value', s.name]];
    case 'DestructureAssign': case 'ListDestructure':
      return patternNames(s.pattern).map(n => ['value', n]);
    default:
      return [];
  }
}

// Bound from the block's start: a cell, a local function, a `use` binding.
const isForward = (s) => s?.type === 'RefDecl'
  || ((s?.type === 'Assign' || s?.type === 'TypedAssign') && (s.value?.type === 'Function' || s.value?.fromUse));

// An actor's own names, with what each one is.
function actorNames(actor, classes) {
  const names = [];
  const { inheritedParams, inheritedFunctions, inheritedState } = actor.name ? resolveSuperclassChain(classes, actor) : {};
  for (const d of [...(actor.stateVarDecls || []), ...(inheritedState || [])]) names.push(['cell', d.name]);
  // A class block's inherited cells, read at its base (src/singleton_classes.js).
  for (const c of actor.forwardCells || []) names.push(['cell', c.name]);
  // And its inherited functions, which its base runs for it.
  for (const f of actor.forwardFns || []) names.push(['function', f]);
  for (const p of [...(actor.initParams || []), ...(actor.params || []), ...(inheritedParams || [])]) {
    names.push(['value', p.name]);
    if (p.accessor) names.push(['value', '@' + p.accessor.replace(/^@/, '')]);
  }
  for (const f of [...(actor.functions || []), ...(inheritedFunctions || [])]) names.push(['function', f.name]);
  for (const s of [...(actor.constructorBody || []), ...(actor.initBody || [])]) names.push(...bindsOf(s));
  return names;
}

// What an unbound `name` might have meant, as the rest of a message.
function alternative(name, scope) {
  for (let sc = scope; sc; sc = sc.parent) {
    const from = sc.noBase?.get(name);
    if (from) return `it's '${from.parent}''s, and '${from.actor}' has no base for '${from.parent}' (it never calls 'super'): define it in '${from.actor}'`;
  }
  if (/^[@#]/.test(name)) return null;
  const at = scope.kind('@' + name);
  if (at === 'cell') return `the published cell is '@${name}'`;
  if (at === 'class') return `the public class is '@${name}'`;
  if (at === 'function') return `the public function is '@${name}'`;
  if (scope.kind('#' + name) === 'function') return `the function is '#${name}'`;
  return null;
}

// The names a file declares as types, with the builtins: what a type
// annotation may name (src/type_names.js), and what no param may share
// (parser.js, resolveLoneNames). A declared actor's type is its class; a
// dependency's is the actor it injects.
export function declaredTypeNames(program) {
  const names = new Set(BUILTIN_TYPE_NAMES);
  const collect = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node.type === 'TypeDecl' && node.name) names.add(node.name);
    if (node.type === 'Actor' && Array.isArray(node.functions) && node.name) names.add(node.name);
    if (node.type === 'ServiceCoercion' && node.name) names.add(node.name);
    if (node.type === 'Dependency') {
      if (node.name) names.add(node.name);
      for (const d of node.destructures || []) if (d.local) names.add(d.local);
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') collect(v);
  };
  collect(program);
  return names;
}

export function resolveNames(program) {
  const actors = program.actors || [];
  const classes = new Map(actors.filter(a => a.name).map(a => [a.name, a]));

  // The program's names shadow the builtins: a file may bind `Math` itself.
  const builtins = new Scope(null);
  builtins.add('namespace', ...Object.keys(NAMESPACE_METHODS));
  builtins.add('value', ...INTRINSICS);
  const global = new Scope(builtins);
  for (const a of actors) {
    global.add('class', a.name, a.singletonOf, a.sourceName, a.bareName);
    // A public class is `@C` in source (src/subclass.js renames it).
    if (a.isPublic) global.add('class', '@' + a.selector);
  }
  for (const t of program.types || []) global.add('class', t.name, t.bareName);
  for (const d of program.dependencies || []) {
    global.add('value', d.name);
    for (const x of d.destructures || []) if (!x.discard && !x.spread) global.add('value', x.local ?? x.name);
  }
  global.add('class', ...Object.keys(program.importedTypes || {}));

  const actorScopes = new Map();
  const scopeOf = (actor) => {
    const key = actor?.name ?? null;
    if (actorScopes.has(key)) return actorScopes.get(key);
    const parent = actor?.name ? scopeOf(classes.get(actor.enclosing) ?? actors.find(a => !a.name)) : global;
    const scope = new Scope(parent);
    if (actor) for (const [kind, name] of actorNames(actor, classes)) scope.add(kind, name);
    // A parent the class builds no base for: its names aren't the class's.
    for (const P of noBaseParents(actor)) {
      const parent = classes.get(P);
      if (!parent) continue;
      const { inheritedFunctions, inheritedState } = resolveSuperclassChain(classes, parent);
      for (const d of [...(parent.functions || []), ...inheritedFunctions, ...(parent.stateVarDecls || []), ...inheritedState]) {
        if (typeof d.name === 'string' && !scope.kinds.has(d.name)) (scope.noBase ??= new Map()).set(d.name, { parent: P, actor: actor.name });
      }
    }
    actorScopes.set(key, scope);
    return scope;
  };

  // `at` is the node that names it, for its line.
  const check = (name, scope, at) => {
    if (typeof name !== 'string' || scope.kind(name)) return;
    const line = at?.loc?.line ? ` (line ${at.loc.line})` : '';
    if (scope.kind(name + '.') === 'function') {
      throw new Error(`'${name}' is not defined — the silent '${name}.' is called '${name}(…)...'${line}`);
    }
    const alt = alternative(name, scope);
    throw new Error(alt ? `'${name}' isn't in scope — ${alt}${line}` : `'${name}' is not defined${line}`);
  };

  // A block: its statements in order. A name is bound from its statement on,
  // or from the block's start (isForward).
  const visitBlock = (stmts, parent) => {
    const scope = new Scope(parent);
    for (const s of stmts) if (isForward(s)) for (const [kind, name] of bindsOf(s)) scope.add(kind, name);
    for (const s of stmts) {
      visit(s, scope);
      for (const [kind, name] of bindsOf(s)) scope.add(kind, name);
    }
  };

  const visitFunction = (fn, parent) => {
    const scope = new Scope(parent);
    // A default may read any param, a later one too.
    for (const p of fn.params || []) {
      scope.add('value', p?.name);
      if (p?.pattern) scope.add('value', ...patternNames(p.pattern));
    }
    for (const p of fn.params || []) if (p?.defaultValue) visit(p.defaultValue, scope);
    if (fn.target) visit(fn.target, parent);
    if (fn.args) visit(fn.args, parent);
    if (Array.isArray(fn.body)) visitBlock(fn.body, scope);
    if (fn.expr) visit(fn.expr, scope);
  };

  const visitFields = (reply, scope) => {
    for (const f of reply.fields || []) {
      if (!f || typeof f !== 'object') continue;
      // A reply shorthand names what it returns: `return total`, `return :total`.
      if (f.positional && !f.expr && !f.value && typeof f.name === 'string') check(f.name, scope, reply);
      if (typeof f.sigil === 'string' && !f.expr && !f.value) check(f.sigil, scope, reply);
      for (const [k, v] of Object.entries(f)) if (k !== 'loc' && v && typeof v === 'object') visit(v, scope);
    }
  };

  const visit = (node, scope) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { visitBlock(node, scope); return; }
    switch (node.type) {
      case 'FunctionDecl': case 'Function': case 'SubscribeCall':
        visitFunction(node, scope);
        return;
      case 'Identifier':
        // `C.count` inside a class names C's members; `*T(…)`'s callee is a type.
        if (!node.viaClass && !node.cellType && !node.outerBase) check(node.name, scope, node);
        return;
      case 'FunctionCallExpr':
        // `f...` calls the silent `f.`, or a local holding a silent function
        // (validate.js, settleElidedDots).
        if (node.elidedDot && node.callee?.type === 'Identifier' && !scope.kind(node.callee.name)) {
          check(node.callee.name.slice(0, -1), scope, node.callee);
          visit(node.args, scope);
          return;
        }
        break;
      // A builtin namespace answers only its own methods, unless a binding shadows it.
      case 'DotCallExpr':
        if (node.object?.type === 'Identifier' && scope.kind(node.object.name) === 'namespace'
            && !NAMESPACE_METHODS[node.object.name].has(node.method)) {
          throw new Error(`'${node.object.name}' has no method '${node.method}'`);
        }
        break;
      case 'RefRead': case 'FnRef': case 'RefArg':
        if (!node.outerBase) check(node.name, scope, node);
        return;
      case 'SetStatement': case 'ActorSetStatement':
        check(node.name, scope, node);
        break;
      case 'ActorFieldSet':
        check(node.objectName, scope, node);
        break;
      case 'Reply': case 'Return':
        visitFields(node, scope);
        return;
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') visit(v, scope);
  };

  for (const actor of actors) {
    const scope = scopeOf(actor);
    for (const fn of actor.functions || []) visit(fn, scope);
    visit(actor.initBody || [], scope);
    for (const p of actor.initParams || []) if (p.defaultValue) visit(p.defaultValue, scope);
    for (const c of actor.asClauses || []) visit(c.expr, scope);
    if (actor.declarationReturn?.expr) visit(actor.declarationReturn.expr, scope);
  }
}
