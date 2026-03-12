const rustParity = [
  '**/__tests__/on.test.js',
  '**/__tests__/structure.test.js',
  '**/__tests__/arguments.test.js',
  '**/__tests__/actor.test.js',
  '**/__tests__/proc.test.js',
  '**/__tests__/function.test.js',
];

export default {
  projects: [
    {
      displayName: 'js',
      testEnvironment: 'node',
      collectCoverageFrom: ['index.js'],
      transform: {},
      testMatch: ['**/__tests__/**/*.test.js'],
      testPathIgnorePatterns: ['/node_modules/'],
    },
    {
      displayName: 'rust',
      testEnvironment: 'node',
      transform: {},
      testMatch: rustParity,
      testPathIgnorePatterns: ['/node_modules/'],
    },
  ],
};
