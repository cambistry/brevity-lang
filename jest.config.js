const allTests = ['**/__tests__/*.test.js'];

const rustExclude = [
  'type_dependency',
];

const erlangExclude = [
  'type_dependency',
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
