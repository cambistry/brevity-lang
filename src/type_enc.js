// Reading encoded types (src/opre_types.js, notes/opre-type-encoding-2026-11-21.md).
// A pass asks what a type is through these, and never takes a type's text apart.
//
// Encodings are interned: two equal ones are one value, so `===`, a Map key and a
// Set hold for them as for a type's name. An interned value is never changed;
// a pass that copies the tree keeps it as it is (`isInterned`).

const interned = new Map();
const members_ = new WeakSet();

export const isInterned = (v) => !!v && typeof v === 'object' && members_.has(v);

// The one value for `t`'s structure. A string (an address) is itself.
export function intern(t) {
  if (t === null || t === undefined || typeof t !== 'object') return t;
  if (members_.has(t)) return t;
  const inner = Array.isArray(t) ? t.map(intern) : Object.fromEntries(Object.entries(t).map(([k, v]) => [k, intern(v)]));
  const key = keyOf(inner);
  if (!interned.has(key)) { interned.set(key, inner); members_.add(inner); }
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

// ── Addresses ─────────────────────────────────────────────────────────────────
// An address of the file's own: its tokens, without the leading colon and an
// instance's `*`. `:W:X` is `['W', 'X']`; null for any other type.
export const ownPath = (t) => {
  if (typeof t !== 'string' || !t.startsWith(':')) return null;
  const segs = t.slice(1).split(':');
  if (segs[segs.length - 1] === '*') segs.pop();
  return segs;
};
// The same, by the names the source declares them with: a private class's `~`
// is its wire label's, not its name's.
export const ownNames = (t) => ownPath(t)?.map(s => s.replace(/^~/, '')) ?? null;
export const isInstance = (t) => typeof t === 'string' && t.endsWith(':*');

// ── Text, for a message ───────────────────────────────────────────────────────
const PLURAL_OF = new Map([['Integer', 'Integers'], ['Text', 'Texts'], ['Float', 'Floats'], ['Boolean', 'Booleans'], ['Blob', 'Blobs'], ['Decimal', 'Decimals'], ['Actor', 'Actors']]);
const isEntries = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some(k => k.startsWith('%'));
const showName = (a) => (ownNames(a) ? ownNames(a).join('::') : a);
const showEntries = (list, nameOf = showName) => list.flatMap(e => (isEntries(e)
  ? Object.entries(e).map(([k, v]) => `${k}: ${show(v, nameOf)}`)
  : [show(e, nameOf)])).join(', ');
const showElement = (p, nameOf) => {
  if (!Array.isArray(p)) return show(p, nameOf);
  const [inner] = p;
  if (typeof inner === 'string' && PLURAL_OF.has(inner)) return PLURAL_OF.get(inner);
  if (isList(inner)) return `Lists of ${showElement(inner[0], nameOf)}`;
  return show(inner, nameOf);
};
// A function type's reply, as its signature writes it after the arrow.
export const showReply = (sig, nameOf = showName) => {
  if (!sig.re) return '.';
  const shapes = Array.isArray(sig.re) ? [sig.re] : sig.re['%or'];
  const self = shapes.some(s => s.length === 1 && isSelf(s[0]));
  return [...shapes.filter(s => !(s.length === 1 && isSelf(s[0]))).map(s => `(${showEntries(s, nameOf)})`), ...(self ? ['self'] : [])].join(' | ');
};
// `nameOf` renders each address; by default, as the type's own name.
export function show(t, nameOf = showName) {
  if (t === undefined) return 'Anything';
  if (t === null) return 'null';
  if (typeof t === 'string') return nameOf(t);
  if (Array.isArray(t)) {
    const name = genericName(t);
    if (name === 'Object') {
      const named = Object.fromEntries(Object.entries(t[t.length - 1]).filter(([k]) => k !== '%t'));
      return `(${showEntries([...t.slice(0, -1), ...(Object.keys(named).length ? [named] : [])], nameOf)})`;
    }
    return `${nameOf(name)} of ${showElement(t[0], nameOf)}`;
  }
  if (isUnion(t)) return t['%or'].map(m => show(m, nameOf)).join(' | ');
  if ('%opt' in t) return show(t['%opt'], nameOf);
  if (isFn(t)) {
    const sig = fnSignature(t);
    return `(${showEntries(sig.args || [], nameOf)}) ${sig.re ? fnArrow(t) : '=>'} ${showReply(sig, nameOf)}`;
  }
  throw new Error(`Unrecognized type: ${JSON.stringify(t)}`);
}

// ── Perspective ───────────────────────────────────────────────────────────────

// `t` as written by the service at `path`, in the reader's terms: each of the
// service's own addresses (`:Point`, `:T:*`) is under `path` (`svc.bv:Point`), as
// any Opre value's addresses are when it passes between perspectives. An address
// the service reaches through its parent (`Integer`) is the reader's too.
export function translate(t, path) {
  const under = (a) => (a === ':' ? path : a.startsWith(':') ? `${path}${a}` : a);
  const walk = (v) => {
    if (typeof v === 'string') return under(v);
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    // A key is a name, never an address; `%t` names a generic by its address.
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === '%names' ? x : walk(x)]));
  };
  return intern(walk(t));
}
