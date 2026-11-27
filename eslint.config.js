// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

// Soft starting rule set: the recommended presets stay on, but every rule the
// existing code already breaks is downgraded to "warn" so `npm run lint`
// passes without a mass rewrite. Fix the warnings gradually and move a rule
// back to "error" once its count reaches zero. The stylistic preset is left
// out on purpose (formatting-only noise).
module.exports = tseslint.config(
  {
    ignores: ["**/OBSOLETE*/**", "**/OBSOLETE*"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "warn",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // Downgraded because existing code violates them (see comment above).
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@angular-eslint/no-empty-lifecycle-method": "warn",
      "@angular-eslint/no-output-on-prefix": "warn",
      "@angular-eslint/component-class-suffix": "warn",
      "@angular-eslint/no-input-rename": "warn",
      "no-empty": "warn",
      "no-case-declarations": "warn",
      "no-duplicate-case": "warn",
      "no-useless-catch": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // Downgraded because existing templates violate them.
      "@angular-eslint/template/no-negated-async": "warn",
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
      "@angular-eslint/template/eqeqeq": "warn",
    },
  }
);
