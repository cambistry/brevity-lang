// Registry of built-in Math methods, shared by parser, inference, and codegen.
// arity: [min, max] argument count (including the numeric operand)
// returns: the Brevity type this method produces
//   - 'Float': always returns Float
//   - 'Integer': always returns Integer
//   - 'numeric': returns same type as input (abs) or promoted type (min, max)
//   - 'pow': same as ** for Integer/Decimal base + Integer exp; Float otherwise
//   - 'Decimal': returns Decimal (divide)
// accepts: which numeric types are valid for the first argument
//   - 'any': Integer, Float, Decimal
//   - 'float-decimal': Float or Decimal only (compile error on Integer)

export const MATH_METHODS = new Map([
  // Rounding — accept Float/Decimal only, return Integer
  ['ceil',   { arity: [1, 1], returns: 'Integer', accepts: 'float-decimal' }],
  ['floor',  { arity: [1, 1], returns: 'Integer', accepts: 'float-decimal' }],
  ['round',  { arity: [1, 1], returns: 'Integer', accepts: 'float-decimal' }],
  ['trunc',  { arity: [1, 1], returns: 'Integer', accepts: 'float-decimal' }],

  // Utility — accept any numeric
  ['abs',    { arity: [1, 1], returns: 'numeric', accepts: 'any' }],
  ['sign',   { arity: [1, 1], returns: 'Integer', accepts: 'any' }],
  ['min',    { arity: [1, Infinity], returns: 'numeric', accepts: 'any' }],
  ['max',    { arity: [1, Infinity], returns: 'numeric', accepts: 'any' }],
  ['pow',    { arity: [2, 2], returns: 'pow', accepts: 'any' }],

  // Constants (0-arity, accessed as Math.pi / Math.e)
  ['pi',     { arity: [0, 0], returns: 'Float', accepts: 'any' }],
  ['e',      { arity: [0, 0], returns: 'Float', accepts: 'any' }],

  // Powers & roots — return Float
  ['sqrt',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['exp',    { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['log',    { arity: [1, 2], returns: 'Float', accepts: 'any' }],

  // Trigonometry — return Float
  ['sin',    { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['cos',    { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['tan',    { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['asin',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['acos',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['atan',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['atan2',  { arity: [2, 2], returns: 'Float', accepts: 'any' }],

  // Hyperbolic — return Float
  ['sinh',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['cosh',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['tanh',   { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['asinh',  { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['acosh',  { arity: [1, 1], returns: 'Float', accepts: 'any' }],
  ['atanh',  { arity: [1, 1], returns: 'Float', accepts: 'any' }],

  // Decimal-specific
  ['divide', { arity: [3, 3], returns: 'Decimal', accepts: 'any' }],

  // Type conversions
  ['to_integer', { arity: [1, 1], returns: 'Integer', accepts: 'any' }],
  ['to_float',   { arity: [1, 1], returns: 'Float',   accepts: 'any' }],
  ['to_decimal',  { arity: [1, 1], returns: 'Decimal', accepts: 'any' }],
]);
