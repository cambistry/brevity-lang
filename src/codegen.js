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

function genHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const assigns = body.filter(s => s.type === 'Assign');
  const fields = reply.fields.map(genReplyField).join(', ');
  const destructure = params.length > 0
    ? `\n        const { ${params.map(p => p.name).join(', ')} } = payload;`
    : '';
  const locals = assigns.map(s => `\n        const ${s.name} = ${genExpr(s.value)};`).join('');
  return `      case "${op}": {${destructure}${locals}
        this.#binding.post({ id, re: { ${op}: { ${fields} } }, to: from });
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

  return active.map(a => genClass(a, a.name ? 'export ' : 'export default ') + '\n').join('\n');
}
