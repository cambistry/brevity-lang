// Reading encoded types (src/opre_types.js, notes/opre-type-encoding-2026-11-21.md).
// A pass asks what a type is through these, and never takes a type's text apart.
//
// Encodings are interned: two equal ones are one value, so `===`, a Map key and a
// Set hold for them as for a type's name.

const interned = new Map();

// The one value for `t`'s structure. A string (an address) is itself.
export function intern(t) {
  if (t === null || t === undefined || typeof t !== 'object') return t;
  if (Object.isFrozen(t) && interned.get(keyOf(t)) === t) return t;
  const inner = Array.isArray(t) ? t.map(intern) : Object.fromEntries(Object.entries(t).map(([k, v]) => [k, intern(v)]));
  const key = keyOf(inner);
  if (!interned.has(key)) interned.set(key, Object.freeze(inner));
  return interned.get(key);
}
const keyOf = (t) => JSON.stringify(t);

const SELF_KEY = '%self';
export const isSelf = (t) => !!t && typeof t === 'object' && t[SELF_KEY] === true;

// ── Unions ────────────────────────────────────────────────────────────────────
export const isUnion = (t) => !!t && typeof t === 'object' && !Array.isArray(t) && '%or' in t;
// A union's members, or the type alone.
export const members = (t) => (isUnion(t) ? t['%or'] : [t]);

// ── Generics ──────────────────────────────────────────────────────────────────
const tagOf = (t) => (Array.isArray(t) && t.length ? t[t.length - 1] : null);
// A generic's name (`List`), or null.
export const genericName = (t) => {
  const tag = tagOf(t);
  return tag && typeof tag === 'object' && !Array.isArray(tag) && '%t' in tag ? tag['%t'] : null;
};
export const isList = (t) => genericName(t) === 'List';
// A List's element; `Anything` when it holds anything.
export const listElement = (t) => {
  if (!isList(t)) return 'Anything';
  const [param] = t;
  return Array.isArray(param) ? param[0] : param;
};
export const listOf = (element) => intern([[element ?? 'Anything'], { '%t': 'List' }]);

// ── Functions ─────────────────────────────────────────────────────────────────
export const isFn = (t) => !!t && typeof t === 'object' && !Array.isArray(t) && '%fn' in t;
export const fnSignature = (t) => (isFn(t) ? t['%fn'][0] : null);
// A function type's arrow: `->` reads, `=>` writes, `~>` makes no claim.
export const fnArrow = (t) => {
  const sig = fnSignature(t);
  if (!sig) return null;
  return sig.writes === false ? '->' : sig.writes === undefined ? '~>' : '=>';
};
// What a function type replies: `silent` (no reply), `self`, `orSelf` (a value on
// some paths, self on others), `empty` (a reply carrying nothing), else a value.
export const fnReply = (t) => {
  const sig = fnSignature(t);
  if (!sig) return null;
  if (!sig.re) return 'silent';
  if (Array.isArray(sig.re)) {
    if (sig.re.length === 1 && isSelf(sig.re[0])) return 'self';
    return sig.re.length ? 'value' : 'empty';
  }
  return sig.re['%or'].some(shape => shape.length === 1 && isSelf(shape[0])) ? 'orSelf' : 'value';
};

// ── Nodes and addresses ───────────────────────────────────────────────────────
export const isNode = (t) => !!t && typeof t === 'object' && !Array.isArray(t) && '%node' in t;
// A cell's type: `*T` and `&T` are nodes of `$get` (and `$set`).
export const cellType = (t) => (isNode(t) && t['%node'].public?.$get ? t['%node'].public.$get[0].re[0] : null);
export const isCell = (t) => cellType(t) !== null && Object.keys(t['%node'].public).every(k => k === '$get' || k === '$set');

// An address of the file's own: its tokens, without the leading colon and an
// instance's `*`. `:W:X` is `['W', 'X']`; null for any other type.
export const ownPath = (t) => {
  if (typeof t !== 'string' || !t.startsWith(':')) return null;
  const segs = t.slice(1).split(':');
  if (segs[segs.length - 1] === '*') segs.pop();
  return segs;
};
export const isInstance = (t) => typeof t === 'string' && t.endsWith(':*');

// ── Text, for a message ───────────────────────────────────────────────────────
const PLURAL_OF = new Map([['Integer', 'Integers'], ['Text', 'Texts'], ['Float', 'Floats'], ['Boolean', 'Booleans'], ['Blob', 'Blobs'], ['Decimal', 'Decimals']]);
const isEntries = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some(k => k.startsWith('%'));
const showName = (a) => (ownPath(a) ? ownPath(a).join('::') : a);
const showEntries = (list) => list.flatMap(e => (isEntries(e)
  ? Object.entries(e).map(([k, v]) => `${k}: ${show(v)}`)
  : [show(e)])).join(', ');
const showElement = (p) => {
  if (!Array.isArray(p)) return show(p);
  const [inner] = p;
  if (typeof inner === 'string' && PLURAL_OF.has(inner)) return PLURAL_OF.get(inner);
  if (isList(inner)) return `Lists of ${showElement(inner[0])}`;
  return show(inner);
};
// A function type's reply, as its signature writes it after the arrow.
export const showReply = (sig) => {
  if (!sig.re) return '.';
  const shapes = Array.isArray(sig.re) ? [sig.re] : sig.re['%or'];
  const self = shapes.some(s => s.length === 1 && isSelf(s[0]));
  return [...shapes.filter(s => !(s.length === 1 && isSelf(s[0]))).map(s => `(${showEntries(s)})`), ...(self ? ['self'] : [])].join(' | ');
};
export function show(t) {
  if (t === null) return 'null';
  if (typeof t === 'string') return showName(t);
  if (Array.isArray(t)) {
    const name = genericName(t);
    if (name === 'Object') {
      const named = Object.fromEntries(Object.entries(t[t.length - 1]).filter(([k]) => k !== '%t'));
      return `(${showEntries([...t.slice(0, -1), ...(Object.keys(named).length ? [named] : [])])})`;
    }
    return `${showName(name)} of ${showElement(t[0])}`;
  }
  if (isUnion(t)) return t['%or'].map(show).join(' | ');
  if ('%opt' in t) return show(t['%opt']);
  if (isFn(t)) {
    const sig = fnSignature(t);
    return `(${showEntries(sig.args || [])}) ${sig.re ? fnArrow(t) : '=>'} ${showReply(sig)}`;
  }
  if (isCell(t)) return show(cellType(t));
  return 'Actor';
}
