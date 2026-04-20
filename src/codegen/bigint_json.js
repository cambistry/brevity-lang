// BigInt-aware JSON serialization/deserialization for test runners.

export function bigintJsonStringify(obj) {
  // Serialize BigInt values as raw number literals in JSON (valid JSON, no quotes)
  const str = JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? `__BIGINT__${v}__` : v);
  return str.replace(/"__BIGINT__(-?\d+)__"/g, '$1');
}

export function bigintJsonParse(str) {
  // Replace large integer literals with BigInt before JSON.parse loses precision
  const patched = str.replace(/:(-?\d{16,})/g, (match, num) => {
    const n = Number(num);
    if (n > Number.MAX_SAFE_INTEGER || n < Number.MIN_SAFE_INTEGER || num !== String(n)) {
      return match.replace(num, `"__BIGINT__${num}__"`);
    }
    return match;
  });
  return JSON.parse(patched, (_, v) => {
    if (typeof v === 'string' && v.startsWith('__BIGINT__') && v.endsWith('__')) {
      return BigInt(v.slice(10, -2));
    }
    return v;
  });
}
