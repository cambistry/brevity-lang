// method_tables.js — Table-driven method dispatch for Erlang codegen
//
// Each entry: ({ s, expr, genArg }) => string
//   s       — generated subject expression
//   expr    — full AST node (for inspecting arg types)
//   genArg  — (i) => string, lazily generates expr.args[i]

function wrapBin(v) {
  return (v.includes('(') || v.includes('#') || v.includes('<<')) ? `(${v})` : v;
}

export const ERL_BLOB_METHODS = {
  'size':        ({ s }) => `byte_size(${s})`,
  'empty?':      ({ s }) => `(${s} =:= <<>>)`,
  'repeat':      ({ s, genArg }) => `binary:copy(${s}, ${genArg(1)})`,
  'reverse':     ({ s }) => `brevity_blob_reverse(${s})`,
  'first':       ({ s }) => `brevity_blob_first(${s})`,
  'last':        ({ s }) => `brevity_blob_last(${s})`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `binary:part(${s}, ${start}, ${end} - ${start})`;
    }
    return `binary:part(${s}, ${start}, byte_size(${s}) - ${start})`;
  },
  'take':        ({ s, genArg }) => `brevity_blob_take(${s}, ${genArg(1)})`,
  'from':        ({ s, genArg }) => `brevity_blob_from(${s}, ${genArg(1)})`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_match(${s}, ${genArg(1)})`;
    return `brevity_text_contains(${s}, ${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_starts_with(${s}, ${genArg(1)})`;
    return `brevity_text_starts_with(${s}, ${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_ends_with(${s}, ${genArg(1)})`;
    return `brevity_text_ends_with(${s}, ${genArg(1)})`;
  },
  'index_of':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_blob_index_of(${s}, ${genArg(1)})`;
    return `brevity_blob_index_of(${s}, ${genArg(1)})`;
  },
  'before':      ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_before(${s}, ${genArg(1)})`;
    return `brevity_text_before(${s}, ${genArg(1)})`;
  },
  'after':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_after(${s}, ${genArg(1)})`;
    return `brevity_text_after(${s}, ${genArg(1)})`;
  },
  'trim':        ({ s }) => `brevity_blob_trim(${s})`,
  'trim_start':  ({ s }) => `brevity_blob_trim_start(${s})`,
  'trim_end':    ({ s }) => `brevity_blob_trim_end(${s})`,
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [global, {return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep}, [global])`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [{return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep})`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `re:split(${s}, ${genArg(1)}, [{return, binary}])`;
    return `binary:split(${s}, ${genArg(1)}, [global])`;
  },
  'lines':       ({ s }) => `binary:split(${s}, [<<$\\n>>, <<$\\r, $\\n>>], [global])`,
  'concat':      ({ s, genArg }) => { const b2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(b2)}/binary>>`; },
  'append':      ({ s, genArg }) => { const b2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(b2)}/binary>>`; },
  'prepend':     ({ s, genArg }) => { const b2 = genArg(1); return `<<${wrapBin(b2)}/binary, ${wrapBin(s)}/binary>>`; },
  'at':          ({ s, genArg }) => `binary:at(${s}, ${genArg(1)})`,
  'zeros':       ({ s }) => `<<0:(${s} * 8)>>`,
  'from_hex':    ({ s }) => `brevity_blob_from_hex(${s})`,
  'to_hex':      ({ s }) => `brevity_blob_to_hex(${s})`,
  'from_base64': ({ s }) => `base64:decode(${s})`,
  'to_base64':   ({ s }) => `base64:encode(${s})`,
  'from_utf8':   ({ s }) => `${s}`,
  'to_utf8':     ({ s }) => `${s}`,
  'xor':         ({ s, genArg }) => `crypto:exor(${s}, ${genArg(1)})`,
  'constant_time_equals': ({ s, genArg }) => { const b2 = genArg(1); return `(byte_size(${s}) =:= byte_size(${b2}) andalso crypto:hash_equals(${s}, ${b2}))`; },
};

export const ERL_TEXT_METHODS = {
  'upper':       ({ s }) => `unicode:characters_to_binary(string:uppercase(${s}))`,
  'lower':       ({ s }) => `unicode:characters_to_binary(string:lowercase(${s}))`,
  'trim':        ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s})))`,
  'trim_start':  ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s}), leading))`,
  'trim_end':    ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s}), trailing))`,
  'empty?':      ({ s }) => `(${s} =:= <<>>)`,
  'repeat':      ({ s, genArg }) => `binary:copy(${s}, ${genArg(1)})`,
  'reverse':     ({ s }) => `unicode:characters_to_binary(lists:reverse(unicode:characters_to_list(${s})))`,
  'first':       ({ s }) => `brevity_text_first(${s})`,
  'last':        ({ s }) => `brevity_text_last(${s})`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `brevity_text_slice(${s}, ${start}, ${end})`;
    }
    return `brevity_text_slice(${s}, ${start})`;
  },
  'take':        ({ s, genArg }) => `brevity_text_take(${s}, ${genArg(1)})`,
  'from':        ({ s, genArg }) => `brevity_text_from(${s}, ${genArg(1)})`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_match(${s}, ${genArg(1)})`;
    return `brevity_text_contains(${s}, ${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_starts_with(${s}, ${genArg(1)})`;
    return `brevity_text_starts_with(${s}, ${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_ends_with(${s}, ${genArg(1)})`;
    return `brevity_text_ends_with(${s}, ${genArg(1)})`;
  },
  'index_of':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_index_of(${s}, ${genArg(1)})`;
    return `brevity_text_index_of(${s}, ${genArg(1)})`;
  },
  'before':      ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_before(${s}, ${genArg(1)})`;
    return `brevity_text_before(${s}, ${genArg(1)})`;
  },
  'after':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_after(${s}, ${genArg(1)})`;
    return `brevity_text_after(${s}, ${genArg(1)})`;
  },
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [global, {return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep}, [global])`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [{return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep})`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `re:split(${s}, ${genArg(1)}, [{return, binary}])`;
    return `binary:split(${s}, ${genArg(1)}, [global])`;
  },
  'lines':       ({ s }) => `binary:split(${s}, [<<$\\n>>, <<$\\r, $\\n>>], [global])`,
  'concat':      ({ s, genArg }) => { const t2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(t2)}/binary>>`; },
  'append':      ({ s, genArg }) => { const t2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(t2)}/binary>>`; },
  'prepend':     ({ s, genArg }) => { const t2 = genArg(1); return `<<${wrapBin(t2)}/binary, ${wrapBin(s)}/binary>>`; },
  'at':          ({ s, genArg }) => `brevity_text_at(${s}, ${genArg(1)})`,
};

export const ERL_GRAPHEME_METHODS = {
  'size':        ({ s }) => `length(brevity_grapheme_list(${s}))`,
  'empty?':      ({ s }) => `(${s} =:= <<>>)`,
  'first':       ({ s }) => `brevity_grapheme_first(${s})`,
  'last':        ({ s }) => `brevity_grapheme_last(${s})`,
  'reverse':     ({ s }) => `unicode:characters_to_binary(lists:reverse(brevity_grapheme_list(${s})))`,
  'repeat':      ({ s, genArg }) => `binary:copy(${s}, ${genArg(1)})`,
  'slice':       ({ s, expr, genArg }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `brevity_grapheme_slice(${s}, ${start}, ${end})`;
    }
    return `brevity_grapheme_slice(${s}, ${start})`;
  },
  'take':        ({ s, genArg }) => `brevity_grapheme_take(${s}, ${genArg(1)})`,
  'from':        ({ s, genArg }) => `brevity_grapheme_from(${s}, ${genArg(1)})`,
  'trim':        ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s})))`,
  'trim_start':  ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s}), leading))`,
  'trim_end':    ({ s }) => `unicode:characters_to_binary(string:trim(unicode:characters_to_list(${s}), trailing))`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_match(${s}, ${genArg(1)})`;
    return `brevity_text_contains(${s}, ${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_starts_with(${s}, ${genArg(1)})`;
    return `brevity_text_starts_with(${s}, ${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_ends_with(${s}, ${genArg(1)})`;
    return `brevity_text_ends_with(${s}, ${genArg(1)})`;
  },
  'index_of':    ({ s, genArg }) => `brevity_grapheme_index_of(${s}, ${genArg(1)})`,
  'before':      ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_before(${s}, ${genArg(1)})`;
    return `brevity_text_before(${s}, ${genArg(1)})`;
  },
  'after':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `brevity_re_after(${s}, ${genArg(1)})`;
    return `brevity_text_after(${s}, ${genArg(1)})`;
  },
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [global, {return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep}, [global])`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `re:replace(${s}, ${genArg(1)}, ${rep}, [{return, binary}])`;
    return `binary:replace(${s}, ${genArg(1)}, ${rep})`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `re:split(${s}, ${genArg(1)}, [{return, binary}])`;
    return `binary:split(${s}, ${genArg(1)}, [global])`;
  },
  'lines':       ({ s }) => `binary:split(${s}, [<<$\\n>>, <<$\\r, $\\n>>], [global])`,
  'concat':      ({ s, genArg }) => { const g2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(g2)}/binary>>`; },
  'append':      ({ s, genArg }) => { const g2 = genArg(1); return `<<${wrapBin(s)}/binary, ${wrapBin(g2)}/binary>>`; },
  'prepend':     ({ s, genArg }) => { const g2 = genArg(1); return `<<${wrapBin(g2)}/binary, ${wrapBin(s)}/binary>>`; },
  'at':          ({ s, genArg }) => `brevity_grapheme_at(${s}, ${genArg(1)})`,
};

// List methods — native Erlang lists; brevity_list_* helpers handle the
// equality-aware methods (contains, index_of, replace, etc.) since those
// need _bv_eq-style cross-type Decimal/Integer compare.
export const ERL_LIST_METHODS = {
  'size':          ({ s }) => `length(${s})`,
  'empty?':        ({ s }) => `(${s} =:= [])`,
  'first':         ({ s }) => `brevity_list_first(${s})`,
  'last':          ({ s }) => `brevity_list_last(${s})`,
  'at':            ({ s, genArg }) => `brevity_list_at(${s}, ${genArg(1)})`,
  'slice':         ({ s, expr, genArg }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `brevity_list_slice(${s}, ${start}, ${end})`;
    }
    return `brevity_list_slice(${s}, ${start})`;
  },
  'take':          ({ s, genArg }) => `brevity_list_take(${s}, ${genArg(1)})`,
  'from':          ({ s, genArg }) => `brevity_list_from(${s}, ${genArg(1)})`,
  'before':        ({ s, genArg }) => `brevity_list_before(${s}, ${genArg(1)})`,
  'after':         ({ s, genArg }) => `brevity_list_after(${s}, ${genArg(1)})`,
  'index_of':      ({ s, genArg }) => `brevity_list_index_of(${s}, ${genArg(1)})`,
  'contains':      ({ s, genArg }) => `brevity_list_contains(${s}, ${genArg(1)})`,
  'starts_with':   ({ s, genArg }) => `brevity_list_starts_with(${s}, ${genArg(1)})`,
  'ends_with':     ({ s, genArg }) => `brevity_list_ends_with(${s}, ${genArg(1)})`,
  'reverse':       ({ s }) => `lists:reverse(${s})`,
  'repeat':        ({ s, genArg }) => `lists:append(lists:duplicate(${genArg(1)}, ${s}))`,
  'replace':       ({ s, genArg }) => `brevity_list_replace(${s}, ${genArg(1)}, ${genArg(2)}, true)`,
  'replace_first': ({ s, genArg }) => `brevity_list_replace(${s}, ${genArg(1)}, ${genArg(2)}, false)`,
  'concat':        ({ s, genArg }) => `(${s} ++ ${genArg(1)})`,
  'append':        ({ s, genArg }) => `(${s} ++ ${genArg(1)})`,
  'prepend':       ({ s, genArg }) => `(${genArg(1)} ++ ${s})`,
  'flatten':       ({ s }) => `lists:append(${s})`,
  'unique':        ({ s }) => `brevity_list_unique(${s})`,
  'sort':          ({ s }) => `lists:sort(${s})`,
  'join':          ({ s, genArg }) => `unicode:characters_to_binary(lists:join(${genArg(1)}, ${s}))`,
};

export function dispatchMethod(table, typeName, expr, subject, genArg) {
  const handler = table[expr.method];
  if (!handler) throw new Error(`Unknown ${typeName} method: ${expr.method}`);
  return handler({ s: subject, expr, genArg });
}
