// method_tables.js — Table-driven method dispatch for Rust codegen
//
// Each entry: ({ s, expr, genArg, intFromI64, intToUsize }) => string
//   s          — generated subject expression (already Value-unwrapped)
//   expr       — full AST node (for inspecting arg types)
//   genArg     — (i) => string, lazily generates expr.args[i]
//   intFromI64 — helper from int_repr.js
//   intToUsize — helper from int_repr.js

export const RUST_BLOB_METHODS = {
  'size':        ({ s, intFromI64 }) => intFromI64(`(${s}.len() as i64)`),
  'empty?':      ({ s }) => `${s}.is_empty()`,
  'repeat':      ({ s, genArg, intToUsize }) => `${s}.repeat(${intToUsize(genArg(1))})`,
  'reverse':     ({ s }) => `String::from_utf8_lossy(&${s}.as_bytes().iter().rev().copied().collect::<Vec<u8>>()).to_string()`,
  'first':       ({ s }) => `if ${s}.is_empty() { String::new() } else { String::from(${s}.as_bytes()[0] as char) }`,
  'last':        ({ s }) => `if ${s}.is_empty() { String::new() } else { String::from(*${s}.as_bytes().last().unwrap() as char) }`,
  'slice':       ({ s, expr, genArg, intToUsize }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `${s}[${intToUsize(start)}..${intToUsize(end)}].to_string()`;
    }
    return `${s}[${intToUsize(start)}..].to_string()`;
  },
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.is_match(${s})`;
    return `${s}.contains(&*${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `Regex::new(&format!("^(?:{})", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
    return `${s}.starts_with(&*${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `Regex::new(&format!("(?:{})$", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
    return `${s}.ends_with(&*${genArg(1)})`;
  },
  'index_of':    ({ s, expr, genArg, intFromI64 }) => {
    if (expr.args[1].type === 'RegexLiteral') return intFromI64(`${genArg(1)}.find(${s}).map_or(-1i64, |m| m.start() as i64)`);
    const nv = genArg(1);
    return intFromI64(`${s}.find(&*${nv}).map_or(-1i64, |i| i as i64)`);
  },
  'before':      ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.find(${s}).map_or(${s}.to_string(), |m| ${s}[..m.start()].to_string())`;
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(_s.to_string(), |i| _s[..i].to_string()))(${s}, &*${nv})`;
  },
  'after':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.find(${s}).map_or(String::new(), |m| ${s}[m.end()..].to_string())`;
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(String::new(), |i| _s[i + _n.len()..].to_string()))(${s}, &*${nv})`;
  },
  'trim':        ({ s }) => `${s}.trim().to_string()`,
  'trim_start':  ({ s }) => `${s}.trim_start().to_string()`,
  'trim_end':    ({ s }) => `${s}.trim_end().to_string()`,
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replace_all(${s}, &*${rep}).to_string()`;
    return `${s}.replace(&*${genArg(1)}, &*${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replacen(${s}, 1, &*${rep}).to_string()`;
    return `${s}.replacen(&*${genArg(1)}, &*${rep}, 1)`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.split(${s}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
    return `${s}.split(&*${genArg(1)}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
  },
  'lines':       ({ s }) => `${s}.lines().map(|l| Value::String(l.to_string())).collect::<Vec<_>>()`,
  'concat':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'append':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'at':          ({ s, genArg, intFromI64, intToUsize }) => intFromI64(`(${s}.as_bytes()[${intToUsize(genArg(1))}] as i64)`),
  'zeros':       ({ s, intToUsize }) => `"\\0".repeat(${intToUsize(s)})`,
  'from_hex':    ({ s }) => `bv_blob_from_hex(&${s})`,
  'to_hex':      ({ s }) => `bv_blob_to_hex(&${s})`,
  'from_base64': ({ s }) => `String::from_utf8(bv_base64_decode(&${s})).unwrap()`,
  'to_base64':   ({ s }) => `bv_base64_encode(&${s})`,
  'from_utf8':   ({ s }) => `${s}.to_string()`,
  'to_utf8':     ({ s }) => `${s}.to_string()`,
  'xor':         ({ s, genArg }) => `bv_blob_xor(&${s}, &${genArg(1)})`,
  'constant_time_equals': ({ s, genArg }) => `bv_blob_ct_eq(&${s}, &${genArg(1)})`,
};

// Helper for Rust TextMethodExpr: wraps needle with .as_str() if it's a Value
function rustNeedle(genArg, needleNode) {
  const nv = genArg(1);
  const isNeedleVal = needleNode.type === 'RefRead' || needleNode.type === 'StateVar';
  return isNeedleVal ? `${nv}.as_str().unwrap_or("")` : nv;
}

export const RUST_TEXT_METHODS = {
  'upper':       ({ s }) => `${s}.to_uppercase()`,
  'lower':       ({ s }) => `${s}.to_lowercase()`,
  'trim':        ({ s }) => `${s}.trim().to_string()`,
  'trim_start':  ({ s }) => `${s}.trim_start().to_string()`,
  'trim_end':    ({ s }) => `${s}.trim_end().to_string()`,
  'empty?':      ({ s }) => `${s}.is_empty()`,
  'repeat':      ({ s, genArg, intToUsize }) => `${s}.repeat(${intToUsize(genArg(1))})`,
  'reverse':     ({ s }) => `${s}.chars().rev().collect::<String>()`,
  'first':       ({ s }) => `${s}.chars().next().map_or(String::new(), |c| c.to_string())`,
  'last':        ({ s }) => `${s}.chars().last().map_or(String::new(), |c| c.to_string())`,
  'slice':       ({ s, expr, genArg, intToUsize }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `${s}.chars().skip(${intToUsize(start)}).take(${intToUsize(`(&${end} - &${start})`)}).collect::<String>()`;
    }
    return `${s}.chars().skip(${intToUsize(start)}).collect::<String>()`;
  },
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.is_match(${s})`;
    return `${s}.contains(&*${rustNeedle(genArg, expr.args[1])})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `Regex::new(&format!("^(?:{})", ${JSON.stringify(expr.args[1].pattern)})).unwrap().is_match(${s})`;
    return `${s}.starts_with(&*${rustNeedle(genArg, expr.args[1])})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `Regex::new(&format!("(?:{})$", ${JSON.stringify(expr.args[1].pattern)})).unwrap().is_match(${s})`;
    return `${s}.ends_with(&*${rustNeedle(genArg, expr.args[1])})`;
  },
  'index_of':    ({ s, expr, genArg, intFromI64 }) => {
    if (expr.args[1].type === 'RegexLiteral') {
      return intFromI64(`${genArg(1)}.find(${s}).map_or(-1i64, |m| ${s}[..m.start()].chars().count() as i64)`);
    }
    const ns = rustNeedle(genArg, expr.args[1]);
    return intFromI64(`${s}.find(&*${ns}).map_or(-1i64, |i| ${s}[..i].chars().count() as i64)`);
  },
  'before':      ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.find(${s}).map_or(${s}.to_string(), |m| ${s}[..m.start()].to_string())`;
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(_s.to_string(), |i| _s[..i].to_string()))(${s}, &*${nv})`;
  },
  'after':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.find(${s}).map_or(String::new(), |m| ${s}[m.end()..].to_string())`;
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(String::new(), |i| _s[i + _n.len()..].to_string()))(${s}, &*${nv})`;
  },
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replace_all(${s}, &*${rep}).to_string()`;
    return `${s}.replace(&*${genArg(1)}, &*${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replacen(${s}, 1, &*${rep}).to_string()`;
    return `${s}.replacen(&*${genArg(1)}, &*${rep}, 1)`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.split(${s}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
    return `${s}.split(&*${genArg(1)}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
  },
  'lines':       ({ s }) => `${s}.lines().map(|l| Value::String(l.to_string())).collect::<Vec<_>>()`,
  'concat':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'append':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'at':          ({ s, genArg, intToUsize }) => `${s}.chars().nth(${intToUsize(genArg(1))}).map_or(String::new(), |c| c.to_string())`,
};

export const RUST_GRAPHEME_METHODS = {
  'size':        ({ s, intFromI64 }) => intFromI64(`(bv_graphemes(&${s}).len() as i64)`),
  'empty?':      ({ s }) => `${s}.is_empty()`,
  'first':       ({ s }) => `bv_graphemes(&${s}).first().map_or(String::new(), |g| g.to_string())`,
  'last':        ({ s }) => `bv_graphemes(&${s}).last().map_or(String::new(), |g| g.to_string())`,
  'reverse':     ({ s }) => `bv_graphemes(&${s}).iter().rev().copied().collect::<Vec<_>>().join("")`,
  'repeat':      ({ s, genArg, intToUsize }) => `${s}.repeat(${intToUsize(genArg(1))})`,
  'slice':       ({ s, expr, genArg, intToUsize }) => {
    const start = genArg(1);
    if (expr.args[2]) {
      const end = genArg(2);
      return `bv_graphemes(&${s}).iter().skip(${intToUsize(start)}).take(${intToUsize(`(&${end} - &${start})`)}).copied().collect::<Vec<_>>().join("")`;
    }
    return `bv_graphemes(&${s}).iter().skip(${intToUsize(start)}).copied().collect::<Vec<_>>().join("")`;
  },
  'trim':        ({ s }) => `${s}.trim().to_string()`,
  'trim_start':  ({ s }) => `${s}.trim_start().to_string()`,
  'trim_end':    ({ s }) => `${s}.trim_end().to_string()`,
  'contains':    ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.is_match(${s})`;
    return `${s}.contains(&*${genArg(1)})`;
  },
  'starts_with': ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `Regex::new(&format!("^(?:{})", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
    return `${s}.starts_with(&*${genArg(1)})`;
  },
  'ends_with':   ({ s, expr, genArg }) => {
    const needle = expr.args[1];
    if (needle.type === 'RegexLiteral') return `Regex::new(&format!("(?:{})$", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
    return `${s}.ends_with(&*${genArg(1)})`;
  },
  'index_of':    ({ s, genArg, intFromI64 }) => {
    const nv = genArg(1);
    return intFromI64(`${s}.find(&*${nv}).map_or(-1i64, |i| bv_graphemes(&${s}[..i]).len() as i64)`);
  },
  'before':      ({ s, genArg }) => {
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(_s.to_string(), |i| _s[..i].to_string()))(${s}, &*${nv})`;
  },
  'after':       ({ s, genArg }) => {
    const nv = genArg(1);
    return `(|_s: &str, _n: &str| _s.find(_n).map_or(String::new(), |i| _s[i + _n.len()..].to_string()))(${s}, &*${nv})`;
  },
  'replace':     ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replace_all(${s}, &*${rep}).to_string()`;
    return `${s}.replace(&*${genArg(1)}, &*${rep})`;
  },
  'replace_first': ({ s, expr, genArg }) => {
    const rep = genArg(2);
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.replacen(${s}, 1, &*${rep}).to_string()`;
    return `${s}.replacen(&*${genArg(1)}, &*${rep}, 1)`;
  },
  'split':       ({ s, expr, genArg }) => {
    if (expr.args[1].type === 'RegexLiteral') return `${genArg(1)}.split(${s}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
    return `${s}.split(&*${genArg(1)}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
  },
  'lines':       ({ s }) => `${s}.lines().map(|l| Value::String(l.to_string())).collect::<Vec<_>>()`,
  'concat':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'append':      ({ s, genArg }) => `format!("{}{}", ${s}, ${genArg(1)})`,
  'at':          ({ s, genArg, intToUsize }) => `bv_graphemes(&${s}).get(${intToUsize(genArg(1))}).map_or(String::new(), |g| g.to_string())`,
};

export function dispatchMethod(table, typeName, expr, subject, genArg, intFromI64, intToUsize) {
  const handler = table[expr.method];
  if (!handler) throw new Error(`Unknown ${typeName} method: ${expr.method}`);
  return handler({ s: subject, expr, genArg, intFromI64, intToUsize });
}
