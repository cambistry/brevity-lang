// A type as the parser's type grammar reads it (src/parser.js), before it is
// encoded as an Opre type (src/opre_types.js). `renderType` gives the text the
// AST holds for a type.
//
//   { k: 'name', path: ['Svc', 'Point'] }       `Svc::Point`; `['@Pub']` for `@Pub`
//   { k: 'of', container: 'List', arg }         `List[Integer]`
//   { k: 'union', members: [node…] }            `A | B`, `A | null`
//   { k: 'null' }                               the `null` of `A | null`
//   { k: 'shape', fields: [{ name, type }] }    `(Text, n: Integer)`; name null if positional
//   { k: 'fn', inputs, outputs, alternatives, arrow, silent, returnsSelf, orSelf }
//                                               `(Integer) -> (Text)`; inputs and outputs
//                                               are `[{ name?, type }]`
//   { k: 'ctor', params, iface, arrow }         `*(p: Integer) -> { … }`; params are
//                                               `[{ name, key, type, text, positional, optional, ref, readonly }]`,
//                                               `text` the param's type as the AST holds it
//   { k: 'cell', type, readOnly }               `*Type`, `&Type`
//   { k: 'iface', text }                        `{ … }`, as service document text

export const TT = {
  name: (path) => ({ k: 'name', path }),
  of: (container, arg) => ({ k: 'of', container, arg }),
  union: (a, b) => ({ k: 'union', members: [...(a.k === 'union' ? a.members : [a]), b] }),
  null: () => ({ k: 'null' }),
  shape: (fields) => ({ k: 'shape', fields }),
  fn: (f) => ({
    k: 'fn', inputs: f.inputs, outputs: f.outputs, arrow: f.arrow ?? '->',
    ...(f.alternatives && { alternatives: f.alternatives }),
    ...(f.silent && { silent: true }), ...(f.returnsSelf && { returnsSelf: true }), ...(f.orSelf && { orSelf: true }),
  }),
  ctor: (params, iface, arrow) => ({ k: 'ctor', params, iface, arrow: arrow ?? '->' }),
  cell: (type, readOnly = false) => ({ k: 'cell', type, readOnly }),
  iface: (text) => ({ k: 'iface', text }),
};

const side = (items) => items.map(i => (i.name != null ? `${i.name}: ${renderType(i.type)}` : renderType(i.type))).join(', ');

export function renderType(node) {
  switch (node.k) {
    case 'name': return node.path.join('::');
    case 'of': return `${node.container}[${renderType(node.arg)}]`;
    case 'union': return node.members.map(renderType).join(' | ');
    case 'null': return 'null';
    case 'shape': return `(${side(node.fields)})`;
    case 'fn': {
      if (node.silent) return `(${side(node.inputs)}) => .`;
      if (node.returnsSelf) return `(${side(node.inputs)}) ${node.arrow} self`;
      const shapes = (node.alternatives ?? [node.outputs]).map(alt => `(${side(alt)})`).join(' | ');
      return `(${side(node.inputs)}) ${node.arrow} ${shapes}${node.orSelf ? ' | self' : ''}`;
    }
    case 'ctor': return `*(${node.params.map(p => (p.positional ? `${p.name} ${p.text}` : `${p.name}: ${p.text}`)).join(', ')}) -> ${node.iface}`;
    case 'cell': return `${node.readOnly ? '&' : '*'}${renderType(node.type)}`;
    case 'iface': return node.text;
    default: throw new Error(`Unknown type node '${node.k}'`);
  }
}
