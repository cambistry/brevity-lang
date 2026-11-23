// What a code generator needs of an encoded type (src/type_enc.js) beyond asking
// what it is: the class it names, as the program is compiled, and the text the
// generated code carries for it.

import { ownPath, ownNames, isInstance, show, members, isList } from '../type_enc.js';
import { PUBLIC_CLASS_SUFFIX } from '../subclass.js';
import { _opre_quote as quote, _opre_split } from './opre_tokens.js';

// The class an encoded type is an instance of, by its name as compiled (a public
// `@C` is `C__pub`, a private `C` is `C`), or null.
export function classNameOf(t) {
  if (!isInstance(t)) return null;
  const path = ownPath(t);
  if (!path || path.length !== 1) return null;
  return path[0].startsWith('~') ? path[0].slice(1) : `${path[0]}${PUBLIC_CLASS_SUFFIX}`;
}

// A type as the generated code carries it (an `$as` op's arg, a runtime message, a
// cell's declared type): as Brevity writes it, a class by its name as compiled, and
// a dependency's address by its alias (`aliases`, from dependencyAliases).
export function typeText(t, aliases = null) {
  return show(t, (a) => {
    const cls = classNameOf(a);
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

// Each dependency's address, and each name one binds, by the alias the file gives it.
export function dependencyAliases(ast) {
  const byAddress = new Map();
  for (const d of ast.dependencies || []) {
    if (d.type !== 'Dependency' || !d.path) continue;
    if (!d.destructures) byAddress.set(quote(d.path), d.name);
    for (const { local, remote } of d.destructures || []) if (remote) byAddress.set(`${quote(d.path)}:${quote(remote)}`, local);
  }
  return byAddress;
}

// Whether a type is a list, or a union led by one (`List of Integers | null`): a
// value of it is generated as a list.
export const leadsWithList = (t) => t !== undefined && isList(members(t)[0]);
