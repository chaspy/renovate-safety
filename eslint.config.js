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
      // Complexity will be gradually reduced - starting with warning level
      'complexity': ['error', 30], // Cognitive complexity threshold set to 30
      'max-depth': ['warn', 6], // Gradually reducing to target of 4
      'no-nested-ternary': 'error', // No nested ternary operators
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }], // Proper exception handling
      'prefer-regex-literals': 'warn', // Use RegExp.exec() instead of String.match()
      '@typescript-eslint/prefer-optional-chain': 'error', // Use optional chaining
      '@typescript-eslint/prefer-string-starts-ends-with': 'error', // Use String#startsWith/endsWith
      'no-useless-escape': 'error', // No unnecessary escape characters
      '@typescript-eslint/no-unnecessary-type-assertion': 'error', // No unnecessary type assertions
      '@typescript-eslint/restrict-template-expressions': ['error', { 
        allowNumber: true, 
        allowBoolean: false, 
        allowAny: false,
        allowNullish: true,
        allowRegExp: false 
      }], // Prevent object stringification in templates
      '@typescript-eslint/no-confusing-void-expression': 'error', // Avoid confusing void expressions
      'no-implicit-coercion': 'error', // Prefer explicit type conversion
      '@typescript-eslint/prefer-readonly': 'error', // Re-enabled for enhanced immutability
      'no-warning-comments': ['warn', { terms: ['TODO', 'FIXME'], location: 'start' }], // Warn on task markers
    },
  },
  // Temporary relaxed rules for refactored files during cognitive complexity reduction
  {
    files: ['src/lib/analysis-steps.ts', 'src/lib/report-helper-functions.ts', 'src/lib/enhanced-report.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },
];