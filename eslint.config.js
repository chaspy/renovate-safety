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
      'no-empty': ['error', { allowEmptyCatch: false }], // Proper exception handling
      'prefer-regex-literals': 'error', // Use RegExp.exec() instead of String.match()
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'], // Prefer type aliases over interfaces for unions
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

      // Rules corresponding to fixed SonarQube issues
      'max-params': ['error', 7], // Max 7 parameters (fixed enhancedLLMAnalysis from 8 to 6)
      '@typescript-eslint/prefer-promise-reject-errors': 'error', // Promise rejection must be Error objects
      '@typescript-eslint/no-redundant-type-constituents': 'error', // Avoid redundant type assignments
      'no-useless-assignment': 'error', // Prevent useless variable assignments
      'no-unused-expressions': 'off', // Use TypeScript version instead
      '@typescript-eslint/no-unused-expressions': ['error', { 
        allowShortCircuit: false,
        allowTernary: false,
        allowTaggedTemplates: false 
      }], // Catch redundant assignments more strictly
      
      // Additional rules to catch SonarQube-style issues
      '@typescript-eslint/no-base-to-string': 'error', // Prevent Object stringification issues
      '@typescript-eslint/require-array-sort-compare': 'error', // Require explicit compare function
      '@typescript-eslint/prefer-includes': 'error', // Use includes() instead of indexOf()
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='match']",
          message: 'Use RegExp.exec() instead of String.match() for better performance and consistency.'
        }
      ], // Detect String.match() usage
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },
];