// Every name in type position is a type, or it's an error, `'X' is not a type`.
// Annotations, params, returns, cell types, `of` arguments, union members, `::`
// paths and constructor profiles are all read with the type grammar
// (parser.js, typeNamesIn). A type name is:
//   - a builtin, or a builtin plural after `of`
//   - a `type` the file declares, a class or declared actor, `class`
//   - an actor a dependency injects, or a name it destructures
//   - a type or class a dependency's document declares, reached through it:
//     `Svc::Point`. Without a document there is nothing to reach it through.

import { typeNamesIn } from './parser.js';
import { declaredTypeNames } from './names.js';

// A node's `type` is its kind; a param's or field's `type` is a type.
const NODE_KINDS = new Set(['Actor', 'ActorFieldSet', 'ActorSetStatement', 'ActorValue', 'AnonymousHtmlActor', 'AsClause',
  'AsExpr', 'Assign', 'BareTypeDecl', 'BaseCall', 'BaseMember', 'BaseSet', 'BinaryExpr', 'BlobMethodExpr', 'BoolLiteral', 'CatchExpr', 'CellNotify', 'CellReady',
  'DecimalLiteral', 'Dependency', 'DestructureAssign', 'DomConstructor', 'DotAccessExpr', 'DotCallExpr', 'ExprStatement',
  'FileParam', 'FloatLiteral', 'FnRef', 'ForStatement', 'Function', 'FunctionCallExpr', 'FunctionDecl', 'FunctionType',
  'GraphemeTextMethodExpr', 'HtmlLiteral', 'Identifier', 'IfBranch', 'IfExpr', 'IfStatement', 'ImplicitReturn', 'IndexExpr',
  'IngestExpr', 'IntLiteral', 'InterpolatedString', 'LabelInvoke', 'Lambda', 'LaunchStatement', 'ListDestructure',
  'ListLiteral', 'ListMethodExpr', 'MathMethodExpr', 'NamedArgsBag', 'NullLiteral', 'ObjectConstructor', 'ObjectLiteral',
  'OuterSet', 'OverExpr', 'ParenExpr', 'PresenceCheck', 'Program', 'QualifiedMember', 'ReduceExpr', 'RefArg', 'RefDecl',
  'RefRead', 'RegexLiteral', 'Reply', 'Return', 'RunDeferred', 'SelfValue', 'ServiceCoercion', 'SetChain', 'SetExpr',
  'SetStatement', 'SilentTerminator', 'SizeExpr', 'StateAssign', 'StateVar', 'StringLiteral', 'SubscribeCall',
  'TextMethodExpr', 'TypeConstruction', 'TypeDecl', 'TypeField', 'TypedAssign', 'TypedValue',
  'UnaryExpr', 'UseExpr', 'UseValue', 'WhileStatement', 'text', 'dom', 'interp', 'handler', 'closure_ref', 'strinterp']);
// Keys whose string value is a type.
const TYPE_KEYS = ['typeName', 'paramType', 'targetType', 'attestedAs', 'valueType'];
// Not types: a silent function's `.`, a void `()`.
const NOT_TYPES = new Set(['.', '()']);
// The class of a dependency a cell holds, as the compiler records it
// (`box = Svc.Box(5)`). A written type has no `.`.
const DEPENDENCY_CLASS = /^\w+(\.\w+)+$/;

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

  const seen = new Set();
  // `own`: the types a document declares, in scope inside it.
  const check = (text, own) => {
    if (typeof text !== 'string' || NOT_TYPES.has(text) || DEPENDENCY_CLASS.test(text)) return;
    const key = own ? `${[...own].join(',')}\u0000${text}` : text;
    if (seen.has(key)) return;
    seen.add(key);
    for (const name of typeNamesIn(text)) {
      if (!isType(name) && !own?.has(name)) throw notAType(name);
    }
  };

  const visit = (node, own) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, own)); return; }
    for (const k of TYPE_KEYS) check(node[k], own);
    // A function's reply shape: `-> (output: Text)` keeps `output: Text`.
    if (typeof node.returnType === 'string') check(/^\w+\s*:/.test(node.returnType) ? `(${node.returnType})` : node.returnType, own);
    if (typeof node.type === 'string' && !NODE_KINDS.has(node.type)) check(node.type, own);
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') visit(v, own);
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
