// Registry of built-in List methods, shared by parser and codegen.
// arity:   [min, max] argument count (including the list operand)
// returns: the Brevity type this method produces. Methods that return the
//          same type as the receiver (i.e. 'List') automatically gain a bang
//          form (`*list.method!`); methods returning Element/Integer/Boolean/
//          Text do not — see assertBangValidRef in src/parser.js.
//
// 'Element' is a placeholder meaning "the element type of the receiver list".
// Validation in src/validate.js checks element-type compatibility for the
// methods that take an element argument (contains, index_of, replace, etc.)
// and restricts `join` to `List of Texts`.

export const LIST_METHODS = new Map([
  // Tier 1 — direct Text parallels
  ['size',          { arity: [1, 1], returns: 'Integer' }],
  ['empty?',        { arity: [1, 1], returns: 'Boolean' }],
  ['first',         { arity: [1, 1], returns: 'Element' }],
  ['last',          { arity: [1, 1], returns: 'Element' }],
  ['at',            { arity: [2, 2], returns: 'Element' }],
  ['slice',         { arity: [2, 3], returns: 'List' }],
  ['take',          { arity: [2, 2], returns: 'List' }],
  ['from',          { arity: [2, 2], returns: 'List' }],
  ['before',        { arity: [2, 2], returns: 'List' }],
  ['after',         { arity: [2, 2], returns: 'List' }],
  ['index_of',      { arity: [2, 2], returns: 'Integer' }],
  ['contains',      { arity: [2, 2], returns: 'Boolean' }],
  ['starts_with',   { arity: [2, 2], returns: 'Boolean' }],
  ['ends_with',     { arity: [2, 2], returns: 'Boolean' }],
  ['reverse',       { arity: [1, 1], returns: 'List' }],
  ['repeat',        { arity: [2, 2], returns: 'List' }],
  ['replace',       { arity: [3, 3], returns: 'List' }],
  ['replace_first', { arity: [3, 3], returns: 'List' }],
  ['concat',        { arity: [2, 2], returns: 'List' }],
  ['append',        { arity: [2, 2], returns: 'List' }],
  ['prepend',       { arity: [2, 2], returns: 'List' }],
  // Tier 2 — list-only essentials
  ['flatten',       { arity: [1, 1], returns: 'List' }],
  ['unique',        { arity: [1, 1], returns: 'List' }],
  ['sort',          { arity: [1, 2], returns: 'List' }],
  ['join',          { arity: [2, 2], returns: 'Text' }],
]);
