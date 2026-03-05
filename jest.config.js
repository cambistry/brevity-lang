export default {
  testEnvironment: 'node',
  collectCoverageFrom: ['index.js'],
  transform: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '__tests__/brevity.test.js'],
};
