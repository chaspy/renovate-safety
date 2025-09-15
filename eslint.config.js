import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        fetch: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['strict'].rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'debug', 'log'] }],

      // SonarCloud-compatible rules
      'complexity': ['error', 15], // Cognitive complexity
      'max-depth': ['warn', 4], // Maximum nesting depth
      'no-nested-ternary': 'error', // No nested ternary operators
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }], // Proper exception handling
      'prefer-regex-literals': 'warn', // Use RegExp.exec() instead of String.match()
      '@typescript-eslint/prefer-optional-chain': 'error', // Use optional chaining
      '@typescript-eslint/prefer-string-starts-ends-with': 'error', // Use String#startsWith/endsWith
      'no-useless-escape': 'error', // No unnecessary escape characters
      '@typescript-eslint/no-unnecessary-type-assertion': 'error', // No unnecessary type assertions
      '@typescript-eslint/prefer-readonly': 'warn', // Mark readonly when not reassigned
      'no-warning-comments': ['warn', { terms: ['TODO', 'FIXME'], location: 'start' }], // TODO warnings
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },
];