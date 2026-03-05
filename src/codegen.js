const STRUCTURE_PREAMBLE = `const Structure = {
  pack(payload) {
    if (payload == null) return { positional: [], named: {}, positional_types: null, named_types: null };
    if (Array.isArray(payload)) {
      const last = payload[payload.length - 1];
      if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
        return { positional: payload.slice(0, -1), named: last, positional_types: null, named_types: null };
      }
      return { positional: payload, named: {}, positional_types: null, named_types: null };
    }
    return { positional: [], named: payload, positional_types: null, named_types: null };
  },
  splat({ positional, named }) {
    const hasPos = positional.length > 0;
    const hasNamed = Object.keys(named).length > 0;
    if (hasPos && hasNamed) return [...positional, named];
    if (hasPos) return positional;
    return named;
  },
};`;

function genExpr(expr) {
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'Identifier')    return expr.name;
  if (expr.type === 'IntLiteral')    return String(expr.value);
  if (expr.type === 'BinaryExpr')    return `${genExpr(expr.left)} ${expr.op} ${genExpr(expr.right)}`;
  throw new Error(`Unknown expression type: ${expr.type}`);
}

function genReplyField(field) {
  if ('sigil' in field) return field.sigil; // JS shorthand property
  return `${field.key}: ${genExpr(field.value)}`;
}

function genDestructure(params) {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n        const ${rest.name} = Structure.pack(payload);`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  if (pos.length > 0 && named.length > 0) {
    return `\n        const [${pos.map(p => p.name).join(', ')}, { ${named.map(namedPart).join(', ')} }] = payload;`;
  } else if (pos.length > 0) {
    return `\n        const [${pos.map(p => p.name).join(', ')}] = payload;`;
  } else {
    return `\n        const { ${named.map(namedPart).join(', ')} } = payload;`;
  }
}

function genReBody(fields) {
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${spread.name})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(f => f.name).join(', ')}, { ${named.map(genReplyField).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(f => f.name).join(', ')}]`;
  } else {
    return `{ ${named.map(genReplyField).join(', ')} }`;
  }
}

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const assigns = body.filter(s => s.type === 'Assign');
  const destructure = genDestructure(params);
  const locals = assigns.map(s => `\n        const ${s.name} = ${genExpr(s.value)};`).join('');
  const reBody = genReBody(reply.fields);
  return `      case "${op}": {${destructure}${locals}
        this.#binding.post({ id, re: { ${op}: ${reBody} }, to: from });
        break;
      }`;
}

function genClass(actor, exportKw) {
  const name = actor.name ? ` ${actor.name}` : '';
  const cases = actor.handlers.map(genHandler).join('\n');
  return `${exportKw}class${name} {
  #binding

  constructor(binding) { this.#binding = binding; }

  receive(message) {
    const { id, from } = message;
    const opName = typeof message.op === 'string' ? message.op : Object.keys(message.op)[0];
    const payload = typeof message.op === 'object' && message.op !== null ? message.op[opName] : {};
    switch (opName) {
${cases}
    }
  }
}`;
}

export function codegen(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0);
  if (active.length === 0) return '';

  const usesStructure = active.some(a =>
    a.handlers.some(h =>
      h.params.some(p => p.rest) ||
      h.body.some(s => s.type === 'Reply' && s.fields.some(f => f.spread))
    )
  );
  const classes = active.map(a => genClass(a, a.name ? 'export ' : 'export default ') + '\n').join('\n');
  return (usesStructure ? STRUCTURE_PREAMBLE + '\n\n' : '') + classes;
}
