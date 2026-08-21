// ESLint-Konfiguration (Flat Config) für den Website-Builder.
// CommonJS + Node-Globals als Basis; Browser-Globals nur für Dateien,
// die Playwright-page.evaluate-Callbacks enthalten (laufen im Browser-Kontext).
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "vendor/", "public/uploads/", "output/"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ignoreRestSiblings: erlaubt das bewusste Herausdestrukturieren von
      // Feldern (z. B. Legacy-Felder aus einem Lead entfernen via ...rest).
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    // Diese Dateien enthalten page.evaluate-Callbacks, die im Browser laufen.
    files: ["comparison.js", "cwv.js", "qa-agent.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
