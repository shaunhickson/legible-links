import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Untrusted text (titles, descriptions, domains) must never be parsed as markup.
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Do not assign innerHTML. Build nodes with createElement/textContent (see src/utils/render.ts).',
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: 'Do not assign outerHTML. Build nodes with createElement/textContent (see src/utils/render.ts).',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Do not call insertAdjacentHTML. Build nodes with createElement/textContent (see src/utils/render.ts).',
        },
      ],
    },
  },
);
