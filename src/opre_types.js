// A Brevity type as an Opre type: the encoding of
// notes/opre-type-encoding-2026-11-21.md ("Types", "Addresses").
//
//   "Integer"                           a type the service's parent defines
//   ":Point"                            the file's own type
//   "svc.bv:Point"                      a type reached through another service
//   ":T:*"                              an instance of the file's class `T`
//   [["Integer"], { "%t": "List" }]     a generic: its parameters, then a `%t` entry
//                                       (named parameters in it); a nested list is
//                                       "any number of"
//   { "%opt": T }                       optional
//   { "%or": [A, B] }                   a union; `null` is JSON null
//   { "%fn": [signature] }              a function: `args`, `re`, `writes`, as an op's
//   { "%node": { public, … } }          an actor with no address of its own: a cell,
//                                       an interface, a constructor profile
//   { "%self": true }                   a reply that is the receiver itself
//
// An entry list (params, a reply, a type's fields) is written as `ty` writes it:
// positional entries are items, named entries sit in one object, after them.
// An anonymous shape `(Text, n: Integer)` is an `Object` with those parameters.

import { TT } from './type_tree.js';
import { parseTypeTree } from './parser.js';
import { _opre_quote as quote } from './codegen/opre_tokens.js';
import { parseInterface } from './codegen/javascript/types.js';
import { interfaceNode } from './service_doc.js';

const PLURAL = new Map([
  ['Integers', 'Integer'], ['Texts', 'Text'], ['Floats', 'Float'], ['Booleans', 'Boolean'],
  ['Blobs', 'Blob'], ['Decimals', 'Decimal'],
]);

export const SELF = Object.freeze({ '%self': true });

// What a type name in a file means, for its address.
//   types     names of the file's `type`s (`Point`; `C::X` for one declared in `C`)
//   classes   names of its classes (`T`, `@T`, `C::Inner`)
//   services  { alias: path } for each dependency
//   serviceClasses(path, rest) true when `rest` names a class in that service
//   bindings  { name: { address, isClass } } for a name a dependency binds (`use :T = "svc"`)
export function typeScope({ types = [], classes = [], services = {}, serviceClasses = () => false, bindings = {} } = {}) {
  const strip = (n) => n.replace(/^@/, '');
  const typeSet = new Set([...types].map(strip));
  const classSet = new Set([...classes].map(strip));
  const tokens = (segs) => segs.map(quote).join(':');
  return {
    // The address of the type `path` names: an instance for a class, unless `asClass`.
    resolve(path, { asClass = false } = {}) {
      const segs = path.map(strip);
      const instance = asClass ? '' : ':*';
      if (Object.hasOwn(bindings, segs[0])) {
        const b = bindings[segs[0]];
        const rest = segs.slice(1);
        if (!rest.length) return `${b.address}${b.isClass ? instance : ''}`;
        return `${b.address}:${tokens(rest)}${serviceClasses(b.address, rest) ? instance : ''}`;
      }
      if (Object.hasOwn(services, segs[0])) {
        const [, ...rest] = segs;
        const head = quote(services[segs[0]]);
        if (!rest.length) return head;
        return `${head}:${tokens(rest)}${serviceClasses(services[segs[0]], rest) ? instance : ''}`;
      }
      const joined = segs.join('::');
      if (typeSet.has(joined)) return `:${tokens(segs)}`;
      if (classSet.has(joined) || path[0].startsWith('@')) return `:${tokens(segs)}${instance}`;
      return tokens(segs);
    },
  };
}

const NO_SCOPE = typeScope();

const many = (node) => {
  if (node.k === 'name' && node.path.length === 1 && PLURAL.has(node.path[0])) return { many: true, node: TT.name([PLURAL.get(node.path[0])]) };
  if (node.k === 'of' && node.container === 'Lists') return { many: true, node: TT.of('List', node.arg) };
  return { many: false, node };
};

export function encodeType(node, scope = NO_SCOPE) {
  switch (node.k) {
    case 'name': return scope.resolve(node.path);
    case 'null': return null;
    case 'union': return { '%or': node.members.map(m => encodeType(m, scope)) };
    case 'of': {
      const arg = many(node.arg);
      const enc = encodeType(arg.node, scope);
      // A List holds any number of its element.
      const param = arg.many || node.container === 'List' ? [enc] : enc;
      return [param, { '%t': scope.resolve([node.container], { asClass: true }) }];
    }
    case 'shape': return tagged(encodeEntries(node.fields, scope), 'Object');
    case 'fn': return { '%fn': [fnSignature(node, scope)] };
    case 'ctor': {
      const sig = {};
      if (node.params.length) sig.args = encodeParams(node.params, scope);
      sig.re = [{ '%node': encodeIface(node.iface, scope) }];
      setWrites(sig, node.arrow);
      return { '%node': { public: { $new: [sig] } } };
    }
    case 'cell': return { '%node': cellNode(encodeType(node.type, scope), { readOnly: node.readOnly }) };
    case 'iface': return { '%node': encodeIface(node.text, scope) };
    default: throw new Error(`Unknown type node '${node.k}'`);
  }
}

// `text`, a type as the parser reads one, encoded.
export function encodeTypeText(text, scope = NO_SCOPE) {
  return encodeType(parseTypeTree(text), scope);
}

// An entry list: `[{ name, type, optional }]`, `name` null (or absent) for a
// positional entry, `type` a type tree.
export function encodeEntries(entries, scope = NO_SCOPE) {
  const out = [];
  let named = null;
  for (const e of entries) {
    let t = e.type ? encodeType(e.type, scope) : 'Anything';
    if (e.optional) t = { '%opt': t };
    if (e.name == null) out.push(t);
    else (named ??= {})[e.name] = t;
  }
  if (named) out.push(named);
  return out;
}

// A param list as a caller writes it: a named param by its key, a positional one by
// position; a ref param is a cell.
export function encodeParams(params, scope = NO_SCOPE) {
  return encodeEntries(params.map(p => ({
    name: p.positional ? null : (p.key ?? p.name),
    type: p.type && (p.ref || p.readonly) ? TT.cell(p.type, !!p.readonly) : p.type,
    optional: p.optional,
  })), scope);
}

// The `%t` entry closes a generic, holding its named parameters.
function tagged(entries, name) {
  const last = entries[entries.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last) && !isWrapper(last)) {
    return [...entries.slice(0, -1), { ...last, '%t': name }];
  }
  return [...entries, { '%t': name }];
}
const isWrapper = (v) => Object.keys(v).some(k => k.startsWith('%'));

const WRITES = { '->': false, '=>': true };
export function setWrites(sig, arrow) {
  if (arrow in WRITES) sig.writes = WRITES[arrow];
  return sig;
}

function fnSignature(node, scope) {
  const sig = {};
  const side = (items) => encodeEntries(items.map(i => ({ name: i.name ?? null, type: i.type })), scope);
  if (node.inputs.length) sig.args = side(node.inputs);
  if (node.returnsSelf) sig.re = [SELF];
  else if (!node.silent) {
    const shapes = (node.alternatives ?? [node.outputs]).map(side);
    sig.re = shapes.length > 1 || node.orSelf ? { '%or': [...shapes, ...(node.orSelf ? [[SELF]] : [])] } : shapes[0];
  }
  return setWrites(sig, node.arrow);
}

// A cell's node: `$get`, and `$set` unless it is read-only.
export function cellNode(type, { readOnly = false, untracked = false } = {}) {
  return {
    public: {
      $get: [{ re: [type], writes: false }],
      ...(!readOnly && { $set: [{ args: [type], writes: untracked ? 'untracked' : true }] }),
    },
  };
}

// An inline interface `{ … }`, as a document node.
const encodeIface = (text, scope) => interfaceNode(parseInterface(text), scope);
