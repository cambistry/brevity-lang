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
//   { "%self": true }                   a reply that is the receiver itself
//
// An entry list (params, a reply, a type's fields) is written as `ty` writes it:
// positional entries are items, named entries sit in one object, after them.
// An anonymous shape `(Text, n: Integer)` is an `Object` with those parameters.
//
// A cell (`*T`, `&T`) encodes as its type, `T`. An interface `{ … }` and a
// constructor profile `(p) -> *{ … }` claim a dependency's shape, after `as`; neither
// is a type that encodes.

import { parseTypeTree } from './parser.js';
import { TT, renderType } from './type_tree.js';
import { _opre_quote as quote } from './codegen/opre_tokens.js';

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
//   within    the classes a name is read inside, outermost first: there, a type or
//             class declared in one is named bare
//   tokensOf  a declared type's or class's address tokens, by its name as declared,
//             where they aren't its name's (`W::X` in a private `W` is `~W:X`)
export function typeScope({ types = [], classes = [], services = {}, serviceClasses = () => false, bindings = {}, within = [], tokensOf = {} } = {}) {
  const strip = (n) => n.replace(/^@/, '');
  const typeSet = new Set([...types].map(strip));
  // A class by its name as declared: `@Pub` is the public class, and a bare `Pub`
  // doesn't name it.
  const classSet = new Set(classes);
  const isClassName = (j) => classSet.has(j) || classSet.has(`@${j}`);
  const tokens = (segs) => segs.map(quote).join(':');
  const declared = (segs) => typeSet.has(segs.join('::')) || isClassName(segs.join('::'));
  return {
    // The same names, read inside the class `name`.
    within: (name) => typeScope({ types, classes, services, serviceClasses, bindings, within: [...within, name], tokensOf }),
    // The address of the type `path` names: an instance for a class, unless `asClass`.
    resolve(path, { asClass = false } = {}) {
      let segs = path.map(strip);
      const instance = asClass ? '' : ':*';
      const own = (name) => tokensOf[name] ?? name.split('::').map(n => quote(strip(n)));
      // `class`, the class of the actor the type is in.
      if (segs[0] === 'class' && within.length) return `:${own(within[within.length - 1]).join(':')}${segs.length > 1 ? `:${tokens(segs.slice(1))}` : instance}`;
      let nested = false;
      const withinNames = within.map(strip);
      for (let i = withinNames.length; i > 0; i--) {
        const inner = [...withinNames.slice(0, i), ...segs];
        if (declared(inner)) { segs = inner; nested = true; break; }
      }
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
      if (typeSet.has(joined)) return `:${own(joined).join(':')}`;
      const written = path.join('::');
      if (classSet.has(written)) return `:${own(written).join(':')}${instance}`;
      if (path[0].startsWith('@')) return `:${tokens(segs)}${instance}`;
      if (nested && isClassName(joined)) return `:${own(classSet.has(joined) ? joined : `@${joined}`).join(':')}${instance}`;
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
    case 'cell': return encodeType(node.type, scope);
    case 'ctor': throw new Error(`A constructor profile can't be a type here: '${renderType(node)}'`);
    case 'iface': throw new Error(`An interface can't be a type here: '${renderType(node).replace(/\s+/g, ' ')}'`);
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
// position.
export function encodeParams(params, scope = NO_SCOPE) {
  return encodeEntries(params.map(p => ({
    name: p.positional ? null : (p.key ?? p.name),
    type: p.type,
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

// A cell's node in a document: `$get`, and `$set` unless it is read-only.
export function cellNode(type, { readOnly = false, untracked = false } = {}) {
  return {
    public: {
      $get: [{ re: [type], writes: false }],
      ...(!readOnly && { $set: [{ args: [type], writes: untracked ? 'untracked' : true }] }),
    },
  };
}
