// `ty` reports the type of the value actually sent. It never holds a union or a
// placeholder such as `Anything`. A slot declared with one of those is tagged at
// runtime from its value (`_bvTyOf` JS, `bv_ty_of` Rust and Erlang), choosing among
// the members worked out here. See notes/session-2026-11-06-ty-from-value.md.
import { unionMembers } from '../return_shapes.js';
import { members, isUnion, isList } from '../type_enc.js';

const KINDS = new Set(['Integer', 'Float', 'Decimal', 'Text', 'Boolean', 'null', 'Object']);
const isPlaceholder = t => t === 'List' || /\bAnything\b/.test(t);

// True when the declared type can't be the tag: a union, `Anything` anywhere in
// it, or a bare `List`.
export function isDynamicTy(t) {
  return typeof t === 'string' && (isPlaceholder(t) || unionMembers(t).length > 1);
}

// The tags a runtime tag may pick from, as [kind, tag] pairs. `kind` is what the
// target's kind function (`_bvAsKind`, `bv_as_kind`) reports for a value of that
// member (a type value's kind is its `__type`, its key); `*` stands for a member with no kind of its own (a class), taken when
// nothing else matches. A slot that admits `Anything` may hold any known type
// value, so every type this file knows is a member too, with its authority tag.
export function tyMembers(t, tagFor, typeDecls) {
  const out = [];
  const add = (kind, tag) => { if (!out.some(e => e[0] === kind)) out.push([kind, tag]); };
  for (const m of unionMembers(t)) {
    if (isPlaceholder(m)) continue;
    if (KINDS.has(m)) add(m, m);
    else if (/^Lists?\b/.test(m)) add('List', m);
    else if (typeDecls?.has(m)) add(tagFor(m), tagFor(m));
    else add('*', tagFor(m));
  }
  if (/\bAnything\b/.test(t)) for (const k of typeDecls?.keys() ?? []) add(tagFor(k), tagFor(k));
  return out;
}

// The types a slot's value may be an instance of, for converting it to wire form:
// the slot's own type, or the type members of a union (every known type when the
// union admits `Anything`). The value's own `__type` picks among them at runtime.
export function wireTypes(t, typeDecls) {
  if (typeof t !== 'string' || !typeDecls) return [];
  if (typeDecls.has(t)) return [t];
  if (!isDynamicTy(t)) return [];
  const members = unionMembers(t);
  if (members.includes('Anything')) return [...typeDecls.keys()];
  return members.filter(m => typeDecls.has(m));
}

// ── The same, for encoded types (src/type_enc.js) ─────────────────────────────
// `typeDecls` keys each declared type by its address.

const mentionsAnything = (t) => t === 'Anything' || (Array.isArray(t) ? t.some(mentionsAnything)
  : t && typeof t === 'object' ? Object.values(t).some(mentionsAnything) : false);
const ENC_KINDS = new Set(['Integer', 'Float', 'Decimal', 'Text', 'Boolean', 'Object']);

export function isDynamicTyEnc(t) {
  return t !== undefined && (mentionsAnything(t) || isUnion(t));
}

// `text` renders a type as a tag carries it.
export function tyMembersEnc(t, tagFor, typeDecls, text) {
  const out = [];
  const add = (kind, tag) => { if (!out.some(e => e[0] === kind)) out.push([kind, tag]); };
  for (const m of members(t)) {
    if (mentionsAnything(m)) continue;
    if (m === null) add('null', 'null');
    else if (ENC_KINDS.has(m)) add(m, m);
    else if (isList(m)) add('List', text(m));
    else if (typeDecls?.has(m)) add(tagFor(m), tagFor(m));
    else add('*', tagFor(m));
  }
  if (mentionsAnything(t)) for (const k of typeDecls?.keys() ?? []) add(tagFor(k), tagFor(k));
  return out;
}

export function wireTypesEnc(t, typeDecls) {
  if (t === undefined || !typeDecls) return [];
  if (typeDecls.has(t)) return [t];
  if (!isDynamicTyEnc(t)) return [];
  if (members(t).includes('Anything')) return [...typeDecls.keys()];
  return members(t).filter(m => typeDecls.has(m));
}
