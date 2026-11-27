// Part of the parser (src/parser.js): once a file's names are settled, every type
// it writes is encoded as an Opre type (src/opre_types.js), in place of its text. A node's
// `typeName` becomes a `typeNameEnc`, a param's `type` a `typeEnc`, and so on, for
// the keys below; an inline interface is read into `interfaceDoc`. A construction's
// `typeName` is the name it's made by, and stays beside its encoding. Names resolve in the file's scope (src/service_doc.js,
// fileScope), and inside a class, in the class's: a type it declares is named bare.

import { parseTypeTree } from './parser.js';
import { encodeType, typeScope } from './opre_types.js';
import { intern } from './type_enc.js';
import { fileScope, readDocument, documentClassTypes } from './service_doc.js';
import { parseInterface, parseParamsDocument } from './parser_interface.js';

// A node's `type` is its kind; a param's or field's `type` is a type.
const NODE_KINDS = new Set(['Actor', 'ActorFieldSet', 'ActorSetStatement', 'ActorValue', 'AnonymousHtmlActor', 'AsClause',
  'AsExpr', 'Assign', 'BareTypeDecl', 'BaseCall', 'BaseMember', 'BaseSet', 'SuperCall', 'SuperInit', 'BinaryExpr', 'BlobMethodExpr', 'BoolLiteral', 'CatchExpr', 'CellNotify', 'CellReady',
  'DecimalLiteral', 'Dependency', 'DestructureAssign', 'DomConstructor', 'DotAccessExpr', 'DotCallExpr', 'ExprStatement',
  'FileParam', 'FloatLiteral', 'FnRef', 'ForStatement', 'Function', 'FunctionCallExpr', 'FunctionDecl', 'FunctionType',
  'GraphemeTextMethodExpr', 'HtmlLiteral', 'Identifier', 'IfBranch', 'IfExpr', 'ImplicitReturn', 'IndexExpr',
  'IngestExpr', 'IntLiteral', 'InterpolatedString', 'LabelInvoke', 'Lambda', 'LaunchStatement', 'ListDestructure',
  'ListLiteral', 'ListMethodExpr', 'MathMethodExpr', 'NamedArgsBag', 'NullLiteral', 'ObjectConstructor', 'ObjectLiteral',
  'OuterSet', 'OverExpr', 'ParenExpr', 'PresenceCheck', 'Program', 'QualifiedMember', 'ReduceExpr', 'RefArg', 'RefDecl',
  'RefRead', 'RegexLiteral', 'RemoteNew', 'Reply', 'Return', 'RunDeferred', 'SelfValue', 'ServiceCoercion', 'SetChain', 'SetExpr',
  'SetStatement', 'SilentTerminator', 'SizeExpr', 'StateAssign', 'StateVar', 'StringLiteral', 'SubscribeCall',
  'TextMethodExpr', 'TypeConstruction', 'TypeDecl', 'TypeField', 'TypedAssign', 'TypedValue',
  'UnaryExpr', 'UseExpr', 'UseValue', 'WhileStatement', 'text', 'dom', 'interp', 'handler', 'closure_ref', 'strinterp']);
// Keys whose string value is a type.
const TYPE_KEYS = ['typeName', 'paramType', 'targetType', 'attestedAs', 'valueType', 'returnType'];
// Not types: a silent function's `.`, a void `()`.
const NOT_TYPES = new Set(['.', '()']);

// A type with no encoding keeps why (`<key>Unencoded`), what it is (`<key>Kind`:
// `ctor` for a constructor profile, `iface` for an interface) and its type tree
// (`<key>Tree`, src/type_tree.js).
const setEnc = (node, key, value) => {
  if (value?.unencoded) {
    node[`${key}Unencoded`] = value.unencoded;
    node[`${key}Kind`] = value.kind;
    node[`${key}Tree`] = value.tree;
  } else node[`${key}Enc`] = value;
};

// The documents `remotes` gives, by path: what says a name a dependency binds is a class.
function remoteDocs(remotes) {
  const docs = {};
  const entries = Array.isArray(remotes) ? remotes.map(r => [r.path, r.service]) : Object.entries(remotes || {});
  for (const [path, service] of entries) {
    if (service && typeof service === 'object') docs[path] = readDocument(service, path);
  }
  return docs;
}

// The class an actor's names are read inside: a singleton's or a class block's is
// the class it is of.
const ownerOf = (a) => a.singletonOf ?? a.membersOf ?? a.name;

export function encodeAstTypes(ast, remotes = null) {
  // Every address a type resolves to that names a class: an instance's type. Each
  // class of the file, and of the documents of the files it uses, is one.
  if (!ast.instanceTypes) Object.defineProperty(ast, 'instanceTypes', { value: new Set(), configurable: true, enumerable: false });
  const classTypes = ast.instanceTypes;
  const entries = Array.isArray(remotes) ? remotes.map(r => [r.path, r.service]) : Object.entries(remotes || {});
  for (const [path, service] of entries) if (service && typeof service === 'object') documentClassTypes(service, path, classTypes);
  const scope = fileScope(ast, remoteDocs(remotes), classTypes);
  const cache = new Map();
  // A constructor profile or an interface has no encoding (src/opre_types.js): a
  // name typed with one carries its text, and why it has no encoding
  // (`<key>Unencoded`), for where an encoding is needed.
  const encode = (text, sc) => {
    if (text === 'null') return null;
    const key = `${sc.key}\u0000${text}`;
    if (!cache.has(key)) {
      const tree = parseTypeTree(text);
      if (tree.k === 'ctor' || tree.k === 'iface') {
        try { encodeType(tree, sc); } catch (e) { cache.set(key, { unencoded: e.message, kind: tree.k, tree }); }
      } else cache.set(key, intern(encodeType(tree, sc)));
    }
    return cache.get(key);
  };
  const keyed = (sc, key) => Object.assign(sc, { key });
  const root = keyed(scope, '');
  const inside = (sc, name) => keyed(sc.within(name), `${sc.key}/${name}`);

  const visit = (node, sc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, sc)); return; }
    const at = (k, text) => {
      setEnc(node, k, encode(text, sc));
      if (!(k === 'typeName' && node.type === 'TypeConstruction')) delete node[k];
    };
    for (const k of TYPE_KEYS) {
      if (typeof node[k] === 'string' && !NOT_TYPES.has(node[k])) at(k, k === 'returnType' && /^\w+\s*:/.test(node[k]) ? `(${node[k]})` : node[k]);
    }
    // `Actor` and `Function` are node kinds and types: an actor node has functions,
    // a function node params.
    const isKind = NODE_KINDS.has(node.type)
      && !(node.type === 'Actor' && !Array.isArray(node.functions))
      && !(node.type === 'Function' && !Array.isArray(node.params));
    if (typeof node.type === 'string' && !isKind && !NOT_TYPES.has(node.type)) at('type', node.type);
    if (node.type === 'Dependency' && typeof node.interface === 'string') {
      // The interface as the compiler reads one, its types encoded too.
      node.interfaceDoc = parseInterface(node.interface.replace(/\}\s*\|[^}]*$/, '}'));
      visit(node.interfaceDoc, sc);
      // `{ … } | A | B`: what its `$as` converts it to.
      const asTypes = (node.interface.match(/\}\s*\|([^}]*)$/)?.[1] ?? '').split('|').map(t => t.trim()).filter(Boolean);
      if (asTypes.length) node.interfaceDoc.__asTypesEnc = asTypes.map(t => encode(t, sc));
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && k !== 'interfaceDoc' && v && typeof v === 'object') visit(v, sc);
  };
  for (const a of ast.actors || []) {
    const owner = ownerOf(a);
    visit(a, owner ? inside(root, owner) : root);
  }
  // A pass that makes a type after the parse (a call that is a construction, say)
  // encodes its name here, as the parser would have: `typeNamed(['X'], actor)`.
  Object.defineProperty(ast, 'typeNamed', {
    value: (path, actor = null) => {
      const owner = actor && ownerOf(actor);
      return intern((owner ? inside(root, owner) : root).resolve(path));
    },
    configurable: true, enumerable: false,
  });
  for (const t of ast.types || []) visit(t, t.ownerClass ? inside(root, t.ownerClass) : root);
  visit(ast.dependencies, root);
  const byName = new Map((ast.actors || []).filter(a => a.name).map(a => [a.name, a]));
  for (const a of ast.actors || []) {
    if (!a.name || a.singletonOf || a.membersOf || a.remoteStub) continue;
    const encl = byName.get(a.home ?? a.enclosing);
    (encl ? inside(root, ownerOf(encl)) : root).resolve([a.sourceName ?? a.name]);
  }
  return ast;
}

// A remote's params document (`( … )`, src/parser_interface.js), each type encoded
// as its service writes it.
export function readParamsDocument(params) {
  const entries = parseParamsDocument(params);
  if (!entries) return null;
  return entries.map(({ type, ...e }) => {
    const tree = parseTypeTree(type);
    return { ...e, typeEnc: intern(encodeType(tree)) };
  });
}

// `text`, a type as the parser reads one, encoded in `scope` (src/opre_types.js).
export function encodeTypeText(text, scope = typeScope()) {
  return encodeType(parseTypeTree(text), scope);
}
