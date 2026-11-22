// Part of the parser (src/parser.js): once a file is read, every type it writes
// is encoded as an Opre type (src/opre_types.js), beside its text. A node's
// `typeName` gets a `typeNameEnc`, a param's `type` a `typeEnc`, and so on, for
// the keys below. Names resolve in the file's scope (src/service_doc.js,
// fileScope), and inside a class, in the class's: a type it declares is named bare.

import { parseTypeTree } from './parser.js';
import { encodeType } from './opre_types.js';
import { intern } from './type_enc.js';
import { fileScope, documentShape } from './service_doc.js';
import { TT } from './type_tree.js';
import { parseInterface } from './codegen/javascript/types.js';

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
// Not types: a silent function's `.`, a void `()`.
const NOT_TYPES = new Set(['.', '()']);

const setEnc = (node, key, value) => { node[`${key}Enc`] = value; };

// The documents `remotes` gives, by path: what says a name a dependency binds is a class.
function remoteDocs(remotes) {
  const docs = {};
  const entries = Array.isArray(remotes) ? remotes.map(r => [r.path, r.service]) : Object.entries(remotes || {});
  for (const [path, service] of entries) {
    if (service && typeof service === 'object') docs[path] = documentShape(service);
  }
  return docs;
}

export function encodeAstTypes(ast, remotes = null) {
  const scope = fileScope(ast, remoteDocs(remotes));
  const cache = new Map();
  const encode = (text, sc) => {
    if (text === 'null') return null;
    const key = `${sc.key}\u0000${text}`;
    if (!cache.has(key)) cache.set(key, intern(encodeType(parseTypeTree(text), sc)));
    return cache.get(key);
  };
  const keyed = (sc, key) => Object.assign(sc, { key });
  const root = keyed(scope, '');
  const inside = (sc, name) => keyed(sc.within(name), `${sc.key}/${name}`);

  const visit = (node, sc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, sc)); return; }
    for (const k of TYPE_KEYS) {
      if (typeof node[k] === 'string' && !NOT_TYPES.has(node[k])) setEnc(node, k, encode(k === 'returnType' && /^\w+\s*:/.test(node[k]) ? `(${node[k]})` : node[k], sc));
    }
    if (typeof node.type === 'string' && !NODE_KINDS.has(node.type) && !NOT_TYPES.has(node.type)) setEnc(node, 'type', encode(node.type, sc));
    if (node.type === 'Dependency' && typeof node.interface === 'string') {
      const text = node.interface.replace(/\}\s*\|[^}]*$/, '}');
      setEnc(node, 'interface', intern(encodeType(TT.iface(text), sc)));
      // The interface as the compiler reads one, its types encoded too.
      node.interfaceDoc = parseInterface(text);
      visit(node.interfaceDoc, sc);
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'loc' && k !== 'interfaceDoc' && v && typeof v === 'object') visit(v, sc);
  };
  for (const a of ast.actors || []) {
    const owner = a.singletonOf ?? a.membersOf ?? a.name;
    visit(a, owner ? inside(root, owner) : root);
  }
  for (const t of ast.types || []) visit(t, t.ownerClass ? inside(root, t.ownerClass) : root);
  visit(ast.dependencies, root);
  return ast;
}
