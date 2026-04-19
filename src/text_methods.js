// Registry of built-in Text methods, shared by parser and codegen.
// arity: [min, max] argument count (including the text operand)
// returns: the Brevity type this method produces

export const TEXT_METHODS = new Map([
  ['size',          { arity: [1, 1], returns: 'Integer' }],
  ['upper',         { arity: [1, 1], returns: 'Text' }],
  ['lower',         { arity: [1, 1], returns: 'Text' }],
  ['trim',          { arity: [1, 1], returns: 'Text' }],
  ['trim_start',    { arity: [1, 1], returns: 'Text' }],
  ['trim_end',      { arity: [1, 1], returns: 'Text' }],
  ['first',         { arity: [1, 1], returns: 'Text' }],
  ['last',          { arity: [1, 1], returns: 'Text' }],
  ['repeat',        { arity: [2, 2], returns: 'Text' }],
  ['slice',         { arity: [2, 3], returns: 'Text' }],
  ['before',        { arity: [2, 2], returns: 'Text' }],
  ['after',         { arity: [2, 2], returns: 'Text' }],
  ['replace',       { arity: [3, 3], returns: 'Text' }],
  ['replace_first', { arity: [3, 3], returns: 'Text' }],
  ['reverse',       { arity: [1, 1], returns: 'Text' }],
  ['index_of',      { arity: [2, 2], returns: 'Integer' }],
  ['empty?',        { arity: [1, 1], returns: 'Boolean' }],
  ['contains',      { arity: [2, 2], returns: 'Boolean' }],
  ['starts_with',   { arity: [2, 2], returns: 'Boolean' }],
  ['ends_with',     { arity: [2, 2], returns: 'Boolean' }],
  ['split',         { arity: [2, 2], returns: 'List' }],
  ['lines',         { arity: [1, 1], returns: 'List' }],
]);
