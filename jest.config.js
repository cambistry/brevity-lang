const allTests = ['**/__tests__/*.test.js'];

const rustExclude = [];

const erlangExclude = [];

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
      globals: { BREVITY_TARGET: 'js' },
    },
    {
      displayName: 'rust',
      testEnvironment: 'node',
      transform: {},
      testMatch: allTests,
      testPathIgnorePatterns: ['/node_modules/', ...exclude(rustExclude)],
      globals: { BREVITY_TARGET: 'rust' },
    },
    {
      displayName: 'erlang',
      testEnvironment: 'node',
      transform: {},
      testMatch: allTests,
      testPathIgnorePatterns: ['/node_modules/', ...exclude(erlangExclude)],
      globals: { BREVITY_TARGET: 'erlang' },
    },
  ],
};
