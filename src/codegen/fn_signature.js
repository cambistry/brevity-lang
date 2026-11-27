// A function as `test.get` reads it: its address, what it is as a value (as
// replying `&f` gives), and its type, the service document's signature form
// (notes/opre-tagged-forms-2026-11-24.md): `["%f", { args, re, writes }]`.
import { returnShapes } from '../return_shapes.js';
import { entryList } from '../service_doc.js';
import { wireLabel, selfAddress } from './wire_labels.js';

const enc = (t) => (t === undefined ? 'Anything' : t);

// The actor's own protected and private functions, by the name `test.get` takes.
export function inspectableFunctions(actor) {
  return (actor.functions || []).filter(f => typeof f.name === 'string' && !f.sourceName
    && /^#?[a-z_][A-Za-z0-9_]*[!.]?$/.test(f.name) && !['set', 'update', 'new', 'as'].includes(f.name));
}

export function fnSignatureForm(fn) {
  const sig = {};
  if (fn.params?.length) {
    sig.args = entryList(fn.params.map(p => ({ name: p.positional === false ? (p.key || p.name) : null, enc: enc(p.typeEnc), optional: !!p.defaultValue })));
  }
  const silent = fn.name.endsWith('.');
  if (!silent) {
    const shapes = returnShapes(fn).alternatives.map(alt => entryList(alt.map(e => ({ name: e.name, enc: enc(e.typeEnc) }))));
    sig.re = shapes.length === 0 ? [] : shapes.length === 1 ? shapes[0] : ['%or', ...shapes];
  }
  sig.writes = silent || fn.name.endsWith('!');
  return ['%f', sig];
}

// A function as a value: its address, relative to its actor (`#<:~f>`), as `#<:C>`
// is for a class the actor declares. `get` names it by its label, `~f` (fnKey).
export const fnAddressOf = (name) => '#<' + selfAddress(name) + '>';
export const fnAddress = (fn) => fnAddressOf(fn.name);
export const fnKey = (fn) => wireLabel(fn.name);
