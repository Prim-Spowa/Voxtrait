import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // L'initialisation de l'environnement jsdom est lourde sur cette machine
    // (~5 s par fichier observés) ; le défaut de 5 s pour un test entier est
    // alors trop juste pour les suites de composant qui enchaînent `userEvent`
    // + `waitFor`. Marge portée à 15 s.
    testTimeout: 15000,
    // `.trunk/` (outillage du linter Trunk) contient une arborescence
    // temporaire profondément imbriquée qui fait planter le parcours de
    // fichiers de Vitest (`EBUSY: scandir`). On l'exclut explicitement, en
    // plus des exclusions par défaut (`node_modules`, `dist`, …).
    exclude: [...configDefaults.exclude, "**/.trunk/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // `tsconfig.json` fixe `"jsx": "preserve"` (Next.js fait sa propre
  // transformation JSX). Sans plugin React, l'esbuild de Vitest retomberait
  // sur la transformation « classic » (`React.createElement`) et échouerait
  // avec « React is not defined » dans tous les tests de composant. On force
  // le runtime JSX automatique (`react/jsx-runtime`), qui n'exige pas d'avoir
  // `React` dans la portée.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
