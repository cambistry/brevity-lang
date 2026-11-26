// What a code generator needs of an encoded type (src/type_enc.js) beyond asking
// what it is: the class it names, as the program is compiled, and the text the
// generated code carries for it.

import { ownPath, ownNames, isInstance, show, members, isList } from '../type_enc.js';
import { PUBLIC_CLASS_SUFFIX } from '../subclass.js';
import { _opre_quote as quote, _opre_split } from './opre_tokens.js';
import { publicLabel } from '../singleton_classes.js';
import { makerTag } from '../actor_values.js';
import { renderType } from '../type_tree.js';

// The actor a type names, by its name as compiled: the class an instance is of (a
// public `@C` is `C__pub`, a private `C` is `C`), or a bare name, as an actor no
// `new` built is typed (`s_singleton`). Undefined for anything else.
export function classNameOf(t) {
  if (typeof t !== 'string') return undefined;
  if (!t.includes(':')) return t;
  if (!isInstance(t)) return undefined;
  const path = ownPath(t);
  if (!path || path.length !== 1) return undefined;
  return path[0].startsWith('~') ? path[0].slice(1) : `${path[0]}${PUBLIC_CLASS_SUFFIX}`;
}

// A type as the generated code carries it (an `$as` op's arg, a runtime message, a
// cell's declared type): as Brevity writes it, a class by its name as compiled, and
// a dependency's address by its alias (`aliases`, from dependencyAliases).
export function typeText(t, aliases = null) {
  return show(t, (a) => {
    const cls = isInstance(a) && classNameOf(a);
    if (cls) return cls;
    const own = ownNames(a);
    if (own) return own.join('::');
    const bare = a.replace(/:\*$/, '');
    const alias = aliases?.get(a) ?? aliases?.get(bare);
    if (alias) return alias;
    // A type of a dependency, by the dependency's alias: `Svc::Point`.
    const [head, ...rest] = _opre_split(bare);
    const dep = rest.length ? aliases?.get(quote(head)) : null;
    return dep ? [dep, ...rest].join('::') : a;
  });
}

export { dependencyAliases } from '../type_shown.js';

// Whether a type is a list, or a union led by one (`List of Integers | null`): a
// value of it is generated as a list.
export const leadsWithList = (t) => t !== undefined && isList(members(t)[0]);

// The wire tag for a type-valued slot, `t` encoded: a type's address (`:Point`,
// `svc.bv:Point`; perspective translation fills the authority as the value rises),
// `*` for any actor or one no `new` built, a dependency's class's address, and a
// scalar or list as Brevity writes it. `null` is tagged `null`; no type, no tag.
// `ctx` has the program, `typeDecls` by address and `depAliases`.
// See notes/type-authority-address-tags-2026-10-26.md.
export function typeTag(ctx, t) {
  if (t === undefined) return null;
  if (t === null) return 'null';
  // Any actor (`Actor`) is tagged `*`.
  if (t === 'Actor') return '*';
  // A type's tag is its address (src/codegen/type_table.js).
  if (ctx.typeDecls?.has(t)) return t;
  // An actor no `new` built (a singleton) is tagged `*`.
  const cls = classNameOf(t);
  const node = typeof t === 'string' && ctx.program?.actors?.find(a => a.name === (cls ?? t));
  if (node && (publicLabel(node) ?? node.singletonOf)) return '*';
  if (cls && isInstance(t)) return cls;
  // An actor of a dependency's class is tagged with the class's address
  // (`thing.bv`, `svc.bv:Counter`), never the local name it is bound to.
  if (typeof t === 'string' && !t.startsWith(':') && ownPath(t) === null && !SCALARS.has(t)) return t.replace(/:\*$/, '');
  return typeText(t, ctx.depAliases);
}
const SCALARS = new Set(['Integer', 'Float', 'Decimal', 'Text', 'Boolean', 'Object', 'Anything', 'Function', 'Blob', 'GraphemeText', 'Regex']);

// What a param's type expects of an arg's tag: an actor a `new` built is tagged
// with its maker's address (`:C`); `Actor`, a constructor profile and an interface
// take any actor (`*`). Anything else is matched as it's written.
export function paramTag(ctx, p) {
  const t = p.typeEnc;
  // A param with no type at all (a named one, `a: b`) expects an untagged arg.
  if (t === undefined) return p.typeKind === 'ctor' ? '*' : p.typeTree ? renderType(p.typeTree) : null;
  if (t === 'Actor') return '*';
  const cls = classNameOf(t);
  const node = cls && (ctx.program?.actors || []).find(a => a.name === cls && !a.singletonOf && !a.membersOf);
  if (node) return makerTag(cls);
  return typeText(t, ctx.depAliases);
}


// Whether an encoded type has a generic in it (`List of Integers`, a shape).
export const hasGeneric = (t) => Array.isArray(t) || (t !== null && typeof t === 'object' && Object.values(t).some(hasGeneric));

// Whether a param is declared with a type (one with no encoding, a constructor
// profile or an interface, included).
export const hasType = (p) => p.typeEnc !== undefined || !!p.typeUnencoded;

// A param's type as a type env holds it: a constructor profile, which has no
// encoding, takes any actor with a `new`, so it's `Actor`.
export const envTypeOf = (p) => (p.typeEnc !== undefined ? p.typeEnc : p.typeKind === 'ctor' ? 'Actor' : undefined);

// A function's declared reply when it says one, for how its value is sent: its
// encoded type, or its `.` or `()`.
export const declaredReturn = (fn) => (fn.returnType === '.' || fn.returnType === '()' ? fn.returnType : fn.returnTypeEnc);

// A type that's known, or `Anything`. (`??` would take the `null` type for unknown.)
export const orAny = (t) => (t === undefined ? 'Anything' : t);
