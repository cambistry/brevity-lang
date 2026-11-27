// Whether an actor has anything anyone can reach: a public or protected function or
// cell, a published param, a `self as` clause, a `new`. The file's actor counts its
// types and its public classes too. An actor with only private names (`#f`) has
// nothing to answer, and compiling one is an error (src/validate.js).
export function hasInterface(actor, program) {
  const named = (n) => typeof n === 'string' && n !== '' && !n.startsWith('#');
  if ((actor.functions || []).some(f => named(f.name))) return true;
  if ((actor.stateVarDecls || []).some(v => named(v.name))) return true;
  if ((actor.asClauses || []).length || (actor.initParams || []).length) return true;
  // The file: a factory (a `*` header) has its `new`; its types and classes are its too.
  if (!actor.name && (program?.fileKind === 'factory' || (program?.types || []).length || (program?.actors || []).some(a => a !== actor && a.name))) return true;
  return false;
}
