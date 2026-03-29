import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
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
      'scripts/**',
      'src/libs/**',
      'eslint.config.mjs',
    ],
  },

  // ========================
  // JS 推荐规则
  // ========================
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
  },

  // ========================
  // TypeScript
  // ========================
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      semi: ['error', 'always'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        { allowNamedExports: true, functions: false },
      ],
    },
  },

  // ========================
  // Vue
  // ========================
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser, // <--- 改这里
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    plugins: { vue: vuePlugin },
    rules: {
      'vue/no-empty-component-block': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'no-useless-assignment': 'off',
    },
  },

  // ========================
  // auto-import globals
  // ========================
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts,vue}'],
    languageOptions: {
      globals: autoImport.globals ?? {},
    },
  },

  // ========================
  // 项目自定义规则
  // ========================
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts,vue}'],
    rules: {
      curly: ['error', 'all'],
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
