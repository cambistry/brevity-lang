import js from '@eslint/js';
import jest from 'eslint-plugin-jest';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'convert_tests*.py'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'comma-dangle': ['error', 'always-multiline'],
      'no-empty': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['__tests__/**/*.js'],
    plugins: { jest },
    languageOptions: {
      globals: jest.environments.globals.globals,
    },
  },
  {
    files: ['src/codegen/erlang/**/*.js', 'src/codegen/rust/**/*.js'],
    rules: {
      'no-undef': 'warn',
    },
  },
  {
    // brevity.js and runtime.js run in a browser page (real or Playwright-driven).
    files: ['src/codegen/browser/brevity.js', 'src/codegen/browser/runtime.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
