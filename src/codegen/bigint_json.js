// BigInt-aware JSON serialization/deserialization for test runners.

export function bigintJsonStringify(obj) {
  // Serialize BigInt values as raw number literals in JSON (valid JSON, no quotes)
  const str = JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? `__BIGINT__${v}__` : v);
  return str.replace(/"__BIGINT__(-?\d+)__"/g, '$1');
}

export function bigintJsonParse(str) {
  // An integer literal past what a Number holds exactly becomes a BigInt, wherever
  // it stands (a field's value, a list's element); strings are left as they are.
  let patched = '';
  for (let i = 0; i < str.length;) {
    const c = str[i];
    if (c === '"') {
      let j = i + 1;
      while (j < str.length && str[j] !== '"') j += str[j] === '\\' ? 2 : 1;
      patched += str.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(?![.eE\d])/.exec(str.slice(i, i + 400))?.[0];
    if (num && !/[\w.]/.test(str[i - 1] ?? '')) {
      patched += Number.isSafeInteger(Number(num)) ? num : `"__BIGINT__${num}__"`;
      i += num.length;
      continue;
    }
    patched += c;
    i++;
  }
  return JSON.parse(patched, (_, v) => {
    if (typeof v === 'string' && v.startsWith('__BIGINT__') && v.endsWith('__')) {
      return BigInt(v.slice(10, -2));
    }
    return v;
  });
}
