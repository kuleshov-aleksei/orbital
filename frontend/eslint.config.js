import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import eslintPluginVue from "eslint-plugin-vue"
import globals from "globals"
import typescriptEslint from "typescript-eslint"
import eslintPluginPrettier from "eslint-plugin-prettier"

export default [
  { ignores: ["*.d.ts", "**/coverage", "**/dist"] },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  ...eslintPluginVue.configs["flat/recommended"],
  ...eslintPluginVue.configs["flat/essential"],
  ...eslintPluginVue.configs["flat/strongly-recommended"],
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },
  {
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: {
        parser: typescriptEslint.parser,
        project: "./tsconfig.json",
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      // Enforce <template> at top of file, then script, then style
      "vue/block-order": ["error", { order: ["template", "script", "style"] }],

      // Formatting rules - disabled to let Prettier handle formatting
      "vue/max-attributes-per-line": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/padding-line-between-tags": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/new-line-between-multi-line-property": "off",
      "vue/html-comment-content-spacing": "off",

      // Enforce use of useTemplateRef
      "vue/prefer-use-template-ref": ["error"],

      // Enforce defineOptions for component naming
      "vue/prefer-define-options": ["error"],

      // Enforce PascalCase for component names
      "vue/component-name-in-template-casing": [
        "error",
        "PascalCase",
        {
          registeredComponentsOnly: true,
          ignores: [],
        },
      ],

      // Enforce <script setup lang="ts"> on .vue files
      "vue/block-lang": ["error", { script: { lang: "ts" } }],

      // Enforce <script setup> on .vue files
      "vue/component-api-style": ["error", ["script-setup"]],

      // Enforce typed emits
      "vue/define-emits-declaration": ["error", "type-based"],

      // Enforce order of define macros
      "vue/define-macros-order": ["error", { order: ["defineProps", "defineEmits"] }],

      // Enforce typed props
      "vue/define-props-declaration": ["error", "type-based"],

      // Make sure <button> has type attribute
      "vue/html-button-has-type": [
        "error",
        {
          button: true,
          submit: true,
          reset: true,
        },
      ],

      // Enforce all props with default values be optional
      "vue/no-required-prop-with-default": ["error", { autofix: false }],

      // Enforce refs to have defined types
      "vue/require-typed-ref": ["error"],

      "@typescript-eslint/no-explicit-any": ["error"],
      "prettier/prettier": ["error"],
    },
  },
  eslintConfigPrettier,
]
