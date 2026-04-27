// method_tables.js — Table-driven method dispatch for JS codegen
//
// Each entry: ({ s, expr, genArg }) => string
//   s       — generated subject expression
//   expr    — full AST node (for inspecting arg types)
//   genArg  — (i) => string, lazily generates expr.args[i]

export const JS_BLOB_METHODS = {
  'size':        ({ s }) => `BigInt(_bv_enc.encode(${s}).length)`,
  'empty?':      ({ s }) => `(${s}.length === 0)`,
  'repeat':      ({ s, genArg }) => `${s}.repeat(Number(${genArg(1)}))`,
  'reverse':     ({ s }) => `_bv_blob_reverse(${s})`,
  'first':       ({ s }) => `_bv_blob_first(${s})`,
  'last':        ({ s }) => `_bv_blob_last(${s})`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    const end = expr.args[2] ? genArg(2) : undefined;
    return end ? `_bv_blob_slice(${s}, Number(${start}), Number(${end}))` : `_bv_blob_slice(${s}, Number(${start}))`;
  },
  // take/from clamp at receiver length the same way slice does (JS slice semantics on byte buffer).
  'take':        ({ s, genArg }) => `_bv_blob_slice(${s}, 0, Number(${genArg(1)}))`,
  'from':        ({ s, genArg }) => `_bv_blob_slice(${s}, Number(${genArg(1)}))`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.test(${s})`;
    return `${s}.includes(${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("^(?:" + ${JSON.stringify(needle.pattern)} + ")", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.startsWith(${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("(?:" + ${JSON.stringify(needle.pattern)} + ")$", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.endsWith(${genArg(1)})`;
  },
  'index_of':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `_bv_blob_index_of_re(${s}, ${genArg(1)})`;
    return `_bv_blob_index_of(${s}, ${genArg(1)})`;
  },
  'before':      ({ s, genArg }) => `_bv_text_before(${s}, ${genArg(1)})`,
  'after':       ({ s, genArg }) => `_bv_text_after(${s}, ${genArg(1)})`,
  'trim':        ({ s }) => `${s}.trim()`,
  'trim_start':  ({ s }) => `${s}.trimStart()`,
  'trim_end':    ({ s }) => `${s}.trimEnd()`,
  'replace':     ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.includes('g') ? old.flags : old.flags + 'g';
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replaceAll(${genArg(1)}, ${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.replace('g', '');
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replace(${genArg(1)}, ${rep})`;
  },
  'split':       ({ s, genArg }) => `${s}.split(${genArg(1)})`,
  'lines':       ({ s }) => `${s}.split(/\\r?\\n/)`,
  'concat':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'append':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'prepend':     ({ s, genArg }) => `(${genArg(1)} + ${s})`,
  'at':          ({ s, genArg }) => `BigInt(_bv_enc.encode(${s})[Number(${genArg(1)})])`,
  'zeros':       ({ s }) => `"\\0".repeat(Number(${s}))`,
  'from_hex':    ({ s }) => `_bv_blob_from_hex(${s})`,
  'to_hex':      ({ s }) => `_bv_blob_to_hex(${s})`,
  'from_base64': ({ s }) => `atob(${s})`,
  'to_base64':   ({ s }) => `btoa(${s})`,
  'from_utf8':   ({ s }) => `${s}`,
  'to_utf8':     ({ s }) => `${s}`,
  'xor':         ({ s, genArg }) => `_bv_blob_xor(${s}, ${genArg(1)})`,
  'constant_time_equals': ({ s, genArg }) => `_bv_blob_ct_eq(${s}, ${genArg(1)})`,
};

export const JS_TEXT_METHODS = {
  'upper':       ({ s }) => `${s}.toUpperCase()`,
  'lower':       ({ s }) => `${s}.toLowerCase()`,
  'reverse':     ({ s }) => `[...${s}].reverse().join('')`,
  'first':       ({ s }) => `([...${s}][0] ?? "")`,
  'last':        ({ s }) => `([...${s}].at(-1) ?? "")`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    const end = expr.args[2] ? genArg(2) : undefined;
    return end ? `[...${s}].slice(Number(${start}), Number(${end})).join('')` : `[...${s}].slice(Number(${start})).join('')`;
  },
  // take/from clamp at receiver length via Array.prototype.slice's natural semantics.
  'take':        ({ s, genArg }) => `[...${s}].slice(0, Number(${genArg(1)})).join('')`,
  'from':        ({ s, genArg }) => `[...${s}].slice(Number(${genArg(1)})).join('')`,
  'index_of':    ({ s, genArg }) => `_bv_text_index_of(${s}, ${genArg(1)})`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.test(${s})`;
    return `${s}.includes(${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("^(?:" + ${JSON.stringify(needle.pattern)} + ")", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.startsWith(${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("(?:" + ${JSON.stringify(needle.pattern)} + ")$", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.endsWith(${genArg(1)})`;
  },
  'replace':     ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.includes('g') ? old.flags : old.flags + 'g';
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replaceAll(${genArg(1)}, ${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.replace('g', '');
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replace(${genArg(1)}, ${rep})`;
  },
  'empty?':      ({ s }) => `(${s}.length === 0)`,
  'repeat':      ({ s, genArg }) => `${s}.repeat(Number(${genArg(1)}))`,
  'trim':        ({ s }) => `${s}.trim()`,
  'trim_start':  ({ s }) => `${s}.trimStart()`,
  'trim_end':    ({ s }) => `${s}.trimEnd()`,
  'before':      ({ s, genArg }) => `_bv_text_before(${s}, ${genArg(1)})`,
  'after':       ({ s, genArg }) => `_bv_text_after(${s}, ${genArg(1)})`,
  'split':       ({ s, genArg }) => `${s}.split(${genArg(1)})`,
  'lines':       ({ s }) => `${s}.split(/\\r?\\n/)`,
  'concat':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'append':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'prepend':     ({ s, genArg }) => `(${genArg(1)} + ${s})`,
  'at':          ({ s, genArg }) => `([...${s}][Number(${genArg(1)})] ?? "")`,
};

export const JS_GRAPHEME_METHODS = {
  'size':        ({ s }) => `BigInt(_bv_graphemes(${s}).length)`,
  'empty?':      ({ s }) => `(${s}.length === 0)`,
  'first':       ({ s }) => `(_bv_graphemes(${s})[0] ?? "")`,
  'last':        ({ s }) => `(_bv_graphemes(${s}).at(-1) ?? "")`,
  'reverse':     ({ s }) => `_bv_graphemes(${s}).reverse().join('')`,
  'repeat':      ({ s, genArg }) => `${s}.repeat(Number(${genArg(1)}))`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    const end = expr.args[2] ? genArg(2) : undefined;
    return end ? `_bv_graphemes(${s}).slice(Number(${start}), Number(${end})).join('')` : `_bv_graphemes(${s}).slice(Number(${start})).join('')`;
  },
  // take/from operate on grapheme clusters; clamp via Array.prototype.slice.
  'take':        ({ s, genArg }) => `_bv_graphemes(${s}).slice(0, Number(${genArg(1)})).join('')`,
  'from':        ({ s, genArg }) => `_bv_graphemes(${s}).slice(Number(${genArg(1)})).join('')`,
  'trim':        ({ s }) => `${s}.trim()`,
  'trim_start':  ({ s }) => `${s}.trimStart()`,
  'trim_end':    ({ s }) => `${s}.trimEnd()`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.test(${s})`;
    return `${s}.includes(${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("^(?:" + ${JSON.stringify(needle.pattern)} + ")", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.startsWith(${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `${s}.match(new RegExp("(?:" + ${JSON.stringify(needle.pattern)} + ")$", ${JSON.stringify(needle.flags)})) !== null`;
    return `${s}.endsWith(${genArg(1)})`;
  },
  'index_of':    ({ s, genArg }) => `_bv_grapheme_index_of(${s}, ${genArg(1)})`,
  'before':      ({ s, genArg }) => `_bv_text_before(${s}, ${genArg(1)})`,
  'after':       ({ s, genArg }) => `_bv_text_after(${s}, ${genArg(1)})`,
  'replace':     ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.includes('g') ? old.flags : old.flags + 'g';
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replaceAll(${genArg(1)}, ${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const old = expr.args[1];
    const rep = genArg(2);
    if (old.type === 'RegexLiteral') {
      const flags = old.flags.replace('g', '');
      return `${s}.replace(/${old.pattern}/${flags}, ${rep})`;
    }
    return `${s}.replace(${genArg(1)}, ${rep})`;
  },
  'split':       ({ s, genArg }) => `${s}.split(${genArg(1)})`,
  'lines':       ({ s }) => `${s}.split(/\\r?\\n/)`,
  'concat':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'append':      ({ s, genArg }) => `(${s} + ${genArg(1)})`,
  'prepend':     ({ s, genArg }) => `(${genArg(1)} + ${s})`,
  'at':          ({ s, genArg }) => `(_bv_graphemes(${s})[Number(${genArg(1)})] ?? "")`,
};

// List methods. The receiver `s` is a cons-cell list ({head, tail}) or null for empty.
// All helpers live in LIST_PREAMBLE; this table just dispatches by name.
export const JS_LIST_METHODS = {
  'size':          ({ s }) => `_bv_list_size(${s})`,
  'empty?':        ({ s }) => `(${s} === null)`,
  'first':         ({ s }) => `(${s} === null ? null : ${s}.head)`,
  'last':          ({ s }) => `_bv_list_last(${s})`,
  'at':            ({ s, genArg }) => `_bv_list_at(${s}, Number(${genArg(1)}))`,
  'slice':         ({ s, expr, genArg }) => {
    const start = `Number(${genArg(1)})`;
    const end = expr.args[2] ? `Number(${genArg(2)})` : 'null';
    return `_bv_list_slice(${s}, ${start}, ${end})`;
  },
  'take':          ({ s, genArg }) => `_bv_list_take(${s}, Number(${genArg(1)}))`,
  'from':          ({ s, genArg }) => `_bv_list_from(${s}, Number(${genArg(1)}))`,
  'before':        ({ s, genArg }) => `_bv_list_before(${s}, ${genArg(1)})`,
  'after':         ({ s, genArg }) => `_bv_list_after(${s}, ${genArg(1)})`,
  'index_of':      ({ s, genArg }) => `_bv_list_index_of(${s}, ${genArg(1)})`,
  'contains':      ({ s, genArg }) => `_bv_list_contains(${s}, ${genArg(1)})`,
  'starts_with':   ({ s, genArg }) => `_bv_list_starts_with(${s}, ${genArg(1)})`,
  'ends_with':     ({ s, genArg }) => `_bv_list_ends_with(${s}, ${genArg(1)})`,
  'reverse':       ({ s }) => `_bv_list_reverse(${s})`,
  'repeat':        ({ s, genArg }) => `_bv_list_repeat(${s}, Number(${genArg(1)}))`,
  'replace':       ({ s, genArg }) => `_bv_list_replace(${s}, ${genArg(1)}, ${genArg(2)}, true)`,
  'replace_first': ({ s, genArg }) => `_bv_list_replace(${s}, ${genArg(1)}, ${genArg(2)}, false)`,
  'concat':        ({ s, genArg }) => `_bv_list_concat(${s}, ${genArg(1)})`,
  'append':        ({ s, genArg }) => `_bv_list_concat(${s}, ${genArg(1)})`,
  'prepend':       ({ s, genArg }) => `_bv_list_concat(${genArg(1)}, ${s})`,
  'flatten':       ({ s }) => `_bv_list_flatten(${s})`,
  'unique':        ({ s }) => `_bv_list_unique(${s})`,
  'sort':          ({ s, expr, genArg }) => expr.args[1] ? `_bv_list_sort(${s}, ${genArg(1)})` : `_bv_list_sort(${s})`,
  'join':          ({ s, genArg }) => `_bv_list_join(${s}, ${genArg(1)})`,
};

// Dispatch helper — shared across all three types
export function dispatchMethod(table, typeName, expr, subject, genArg) {
  const handler = table[expr.method];
  if (!handler) throw new Error(`Unknown ${typeName} method: ${expr.method}`);
  return handler({ s: subject, expr, genArg });
}
