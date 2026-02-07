import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import autoImport from './.eslintrc-auto-import.json' with { type: 'json' };

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // ========================
  // 忽略目录
  // ========================
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/libs/**',
      'scripts/**',
    ],
  },

  // ========================
  // JS 基础规则
  // ========================
  js.configs.recommended,

  // ========================
  // TypeScript
  // ========================
  ...tseslint.configs.recommended,

  // ========================
  // Vue 3
  // ========================
  ...vue.configs['flat/recommended'],

  // ========================
  // auto-import globals
  // ========================
  {
    languageOptions: {
      globals: autoImport.globals ?? {},
    },
  },

  // ========================
  // 项目自定义规则
  // ========================
  {
    rules: {
      curly: ['error', 'all'],

      semi: ['error', 'always'],

      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          allowNamedExports: true,
          functions: false,
        },
      ],

      'vue/no-empty-component-block': ['error'],

      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@vueuse/core',
              importNames: ['useClipboard'],
              message:
                'Please use local useCopy from src/composable/copy.ts instead of useClipboard.',
            },
          ],
        },
      ],
    },
  },
];