// Every name in type position is a type, or it's an error, `'X' is not a type`.
// Annotations, params, returns, cell types, `of` arguments, union members, `::`
// paths and constructor profiles are all read with the type grammar
// (parser.js), and each is an address in the type's encoding (src/parser_types.js). A type name is:
//   - a builtin, or a builtin plural after `of`
//   - a `type` the file declares, a class or declared actor, `class`
//   - an actor a dependency injects, or a name it destructures
//   - a type or class a dependency's document declares, reached through it:
//     `Svc::Point`. Without a document there is nothing to reach it through.

import { declaredTypeNames } from './names.js';
import { _opre_quote as quote, _opre_split as split } from './codegen/opre_tokens.js';

// A node's `type` is its kind; a param's or field's `type` is a type.
const NODE_KINDS = new Set(['Actor', 'ActorFieldSet', 'ActorSetStatement', 'ActorValue', 'AnonymousHtmlActor', 'AsClause',
  'AsExpr', 'Assign', 'BareTypeDecl', 'BaseCall', 'BaseMember', 'BaseSet', 'SuperCall', 'SuperInit', 'BinaryExpr', 'BlobMethodExpr', 'BoolLiteral', 'CatchExpr', 'CellNotify', 'CellReady',
  'DecimalLiteral', 'Dependency', 'DestructureAssign', 'DomConstructor', 'DotAccessExpr', 'DotCallExpr', 'ExprStatement',
  'FileParam', 'FloatLiteral', 'FnRef', 'ForStatement', 'Function', 'FunctionCallExpr', 'FunctionDecl', 'FunctionType',
  'GraphemeTextMethodExpr', 'HtmlLiteral', 'Identifier', 'IfBranch', 'IfExpr', 'IfStatement', 'ImplicitReturn', 'IndexExpr',
  'IngestExpr', 'IntLiteral', 'InterpolatedString', 'LabelInvoke', 'Lambda', 'LaunchStatement', 'ListDestructure',
  'ListLiteral', 'ListMethodExpr', 'MathMethodExpr', 'NamedArgsBag', 'NullLiteral', 'ObjectConstructor', 'ObjectLiteral',
  'OuterSet', 'OverExpr', 'ParenExpr', 'PresenceCheck', 'Program', 'QualifiedMember', 'ReduceExpr', 'RefArg', 'RefDecl',
  'RefRead', 'RegexLiteral', 'RemoteNew', 'Reply', 'Return', 'RunDeferred', 'SelfValue', 'ServiceCoercion', 'SetChain', 'SetExpr',
  'SetStatement', 'SilentTerminator', 'SizeExpr', 'StateAssign', 'StateVar', 'StringLiteral', 'SubscribeCall',
  'TextMethodExpr', 'TypeConstruction', 'TypeDecl', 'TypeField', 'TypedAssign', 'TypedValue',
  'UnaryExpr', 'UseExpr', 'UseValue', 'WhileStatement', 'text', 'dom', 'interp', 'handler', 'closure_ref', 'strinterp']);
// Keys whose string value is a type.
const TYPE_KEYS = ['typeName', 'paramType', 'targetType', 'attestedAs', 'valueType', 'returnType'];

export function resolveTypeNames(program, remotesParsed = {}) {
  const declared = declaredTypeNames(program);
  for (const a of program.actors || []) {
    if (a.name) declared.add(a.name);
    if (typeof a.singletonOf === 'string') declared.add(a.singletonOf);
    // A public class is `@C` in source (src/subclass.js renames it).
    if (a.isPublic) declared.add('@' + a.selector);
  }
  for (const t of program.types || []) declared.add(t.name).add(t.bareName);
  // An imported type, by its local name and by the name its document gives it.
  for (const [name, { remote }] of Object.entries(program.importedTypes || {})) declared.add(name).add(remote);

  // `A::B::X`: through a dependency, what its document declares; through a
  // class of this file, a type or class declared in it.
  const reachable = (path) => {
    const [head, ...rest] = path.split('::');
    let doc = remotesParsed[head];
    if (doc) {
      for (const [i, seg] of rest.entries()) {
        if (i === rest.length - 1) return !!(doc.__typeDecls?.[seg] || doc.__types?.[seg] || doc.typeDecls?.[seg]);
        doc = doc.__types?.[seg];
        if (!doc) return false;
      }
    }
    return (program.types || []).some(t => t.name === path) || declared.has(path);
  };
  // A type or class a dependency's document declares is a type here, bare.
  for (const d of program.dependencies || []) {
    const doc = !d.wireClass && remotesParsed[d.name];
    if (doc) for (const name of [...Object.keys(doc.__typeDecls || {}), ...Object.keys(doc.__types || {})]) declared.add(name);
  }
  // A class named with `!` writes while constructing; its actors are typed
  // without it: `w W = W!()`.
  for (const name of [...declared]) if (typeof name === 'string' && name.endsWith('!')) declared.add(name.slice(0, -1));
  const isType = (name) => declared.has(name) || (name.includes('::') && reachable(name));

  // A public class is `@C`, so a bare `C` doesn't name it.
  const notAType = (name) => declared.has('@' + name)
    ? new Error(`'${name}' isn't in scope — the public class is '@${name}'`)
    : new Error(`'${name}' is not a type`);

  // How the file writes the head of an address it reaches through a dependency: a
  // service's path by its alias, a destructured binding (`path:remote`) by its local
  // name.
  const headOf = new Map();
  for (const d of program.dependencies || []) {
    if (d.type !== 'Dependency' || !d.path) continue;
    if (!d.destructures) headOf.set(quote(d.path), d.name);
    for (const { local, remote } of d.destructures || []) if (remote) headOf.set(`${quote(d.path)}:${quote(remote)}`, local);
  }

  // Every name a type is written with is an address in its encoding: the file's
  // own (`:Point`), one through a dependency (`svc.bv:Point`), or a name the file
  // didn't resolve, which is itself. `own`: the types a document declares, in
  // scope inside it.
  const checkAddress = (a, own) => {
    if (typeof a !== 'string' || a.startsWith(':')) return;
    const tokens = split(a).filter(t => t !== '*');
    for (let n = tokens.length; n > 0; n--) {
      const head = headOf.get(tokens.slice(0, n).map(quote).join(':'));
      if (head === undefined) continue;
      if (n === tokens.length) return;
      const written = [head, ...tokens.slice(n)].join('::');
      if (!isType(written)) throw notAType(written);
      return;
    }
    const written = tokens.join('::');
    if (!isType(written) && !own?.has(written)) throw notAType(written);
  };
  const checkEnc = (t, own) => {
    if (typeof t === 'string') { checkAddress(t, own); return; }
    if (!t || typeof t !== 'object') return;
    if (Array.isArray(t)) { t.forEach(x => checkEnc(x, own)); return; }
    for (const [k, v] of Object.entries(t)) {
      if (k === '%t') checkAddress(v, own);
      else if (k !== '%names' && k !== '%self') checkEnc(v, own);
    }
  };

  const visit = (node, own) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, own)); return; }
    for (const k of TYPE_KEYS) checkEnc(node[`${k}Enc`], own);
    if (typeof node.type === 'string' && !NODE_KINDS.has(node.type)) checkEnc(node.typeEnc, own);
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && !k.endsWith('Enc') && v && typeof v === 'object') visit(v, own);
  };
  visit(program.actors);
  visit(program.types);
  // A parent is checked as a class (validate.js); a bare one that's public is named.
  for (const a of program.actors || []) {
    for (const { supertype } of a.supertypes || []) {
      if (typeof supertype === 'string' && !isType(supertype) && declared.has('@' + supertype)) throw notAType(supertype);
    }
  }
  for (const d of program.dependencies || []) {
    // A class of a dependency's document was checked where it's declared.
    if (d.wireClass) continue;
    visit(d);
    // A document written here: its types read in this file, and in the document,
    // which may declare its own.
    if (d.interface && remotesParsed[d.name]) {
      const doc = remotesParsed[d.name];
      visit(doc, new Set([...Object.keys(doc.__typeDecls || {}), ...Object.keys(doc.__types || {})]));
    }
  }
}
