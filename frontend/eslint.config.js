import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

export default typescriptEslint.config(
  { ignores: ['*.d.ts', '**/coverage', '**/dist'] },
  {
    extends: [
      eslint.configs.recommended,
      ...typescriptEslint.configs.recommendedTypeChecked,
      ...eslintPluginVue.configs['flat/recommended'],
      ...eslintPluginVue.configs['flat/essential'],
      ...eslintPluginVue.configs['flat/strongly-recommended'],
    ],
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        parser: typescriptEslint.parser,
        project: './tsconfig.json',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // Enforce <template> at top of file, then script, then style
      'vue/block-order': [
        'error',
        { order: ['template', 'script', 'style'] },
      ],

      // Enforce new line between each attribute
      'vue/max-attributes-per-line': [
        'error',
        {
          singleline: { max: 1 },
          multiline: { max: 1 },
        },
      ],

    'vue/first-attribute-linebreak': [
      'error',
      {
        singleline: 'beside',
        multiline: 'below',
      },
    ],

    // Enforce new line between each tag
    'vue/padding-line-between-tags': [
      'error',
      [{
        blankLine: 'always',
        prev: '*',
        next: '*',
      }],
    ],

    // Enforce new line after singline elements
    'vue/singleline-html-element-content-newline': [
      'error',
      {
        ignoreWhenNoAttributes: true,
        ignoreWhenEmpty: true,
      },
    ],

    // Enforce use of useTemplateRef
    'vue/prefer-use-template-ref': ['error'],

    // Enforce new line between multi-line properties
    'vue/new-line-between-multi-line-property': ['error', { minLineOfMultilineProperty: 2 }],

    // Enforce defineOptions for component naming
    'vue/prefer-define-options': ['error'],

    // Enforce PascalCase for component names
    'vue/component-name-in-template-casing': [
      'error',
      'PascalCase',
      {
        registeredComponentsOnly: true,
        ignores: [],
      },
    ],

    // Enforce <script setup lang="ts"> on .vue files
    'vue/block-lang': [
      'error',
      { script: { lang: 'ts' } },
    ],

    // Enforce <script setup> on .vue files
    'vue/component-api-style': [
      'error',
      ['script-setup'],
    ],

    // Enforce typed emits
    'vue/define-emits-declaration': ['error', 'type-based'],

    // Enforce order of define macros
    'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],

    // Enforce typed props
    'vue/define-props-declaration': ['error', 'type-based'],

    // Make sure <button> has type attribute
    'vue/html-button-has-type': ['error', {
      button: true,
      submit: true,
      reset: true,
    }],

    // Enforce whitespace around comment content
    'vue/html-comment-content-spacing': ['error', 'always'],

    // Enforce all props with default values be optional
    'vue/no-required-prop-with-default': ['error', { autofix: false }],
      
    // Enforce refs to have defined types
    'vue/require-typed-ref': ['error'],

    //'@typescript-eslint/no-unsafe-member-access': ['error'],

    '@typescript-eslint/no-explicit-any': ['error'],
    },
  },
  eslintConfigPrettier
);
