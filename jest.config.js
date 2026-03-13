const allTests = ['**/__tests__/*.test.js'];

const rustExclude = [
  'actor',
  'callable',
  'callable_params',
  'end_proc',
  'external_send',
  'function_params',
  'function_return',
  'list',
  'literal_type_inference',
  'on_params',
  'over',
  'recursion',
  'reduce',
  'ref',
  'repeat_until',
  'repeat_while',
  'runtime_error',
  'spawn',
  'structure_literal',
  'trailing_block',
  'use',
];

const erlangExclude = [
];

const exclude = (names) =>
  names.map(n => `__tests__/${n}.test.js`);

export default {
  projects: [
    {
      displayName: 'js',
      testEnvironment: 'node',
      transform: {},
      testMatch: allTests,
      testPathIgnorePatterns: ['/node_modules/'],
    },
    {
      displayName: 'rust',
      testEnvironment: 'node',
      transform: {},
      testMatch: allTests,
      testPathIgnorePatterns: ['/node_modules/', ...exclude(rustExclude)],
    },
    {
      displayName: 'erlang',
      testEnvironment: 'node',
      transform: {},
      testMatch: allTests,
      testPathIgnorePatterns: ['/node_modules/', ...exclude(erlangExclude)],
    },
  ],
};
