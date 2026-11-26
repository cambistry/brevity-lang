// Where each class of a program is declared, which fixes the address an actor of
// it has when it leaves the file: it lives where its class is declared, whoever
// built it (notes/class-of-and-self-return-2026-11-23.md).
//
// A site is `{ path }`, the class's address tokens relative to the file, when that
// is fixed: a class of the file (`Box`, `~C`), one in a class block (`~A:~B`), one
// in a singleton (`~s:~C`). A class an instance body declares is under that
// instance, so its site is `{ token, inInstance }`: the instance's address, then
// its token (`Outer:1:~Inner`). Null for a class nested deeper inside an instance.
import { homeOf } from '../outer_reads.js';

export const classToken = (a) =>
  (a.isPublic ? (a.selector ?? (a.sourceName ?? a.name).replace(/^@/, '')) : '~' + (a.sourceName ?? a.name).replace(/^@/, ''));

export function classSites(program) {
  const actors = program?.actors || [];
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const pathOf = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    // A class block stands for its class.
    if (node.membersOf) return pathOf(byName.get(node.membersOf), seen);
    const site = homeOf(node);
    if (site === null) return [classToken(node)];
    const encl = byName.get(site);
    if (!encl) return null;
    // Declared in an instance body: no fixed path.
    if (!encl.singletonOf && !encl.membersOf) return null;
    const above = pathOf(encl, seen);
    return above && [...above, classToken(node)];
  };
  const sites = new Map();
  for (const a of actors) {
    if (!a.name || a.singletonOf || a.membersOf) continue;
    const path = pathOf(a);
    if (path) { sites.set(a.name, { path }); continue; }
    const encl = byName.get(homeOf(a));
    if (encl && !encl.singletonOf && !encl.membersOf) sites.set(a.name, { token: classToken(a), inInstance: true });
  }
  return sites;
}
