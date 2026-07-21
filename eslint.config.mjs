import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/route-app.tsx", "app/page.tsx"],
    rules: {
      // Estos controladores restauran sesión/jornada desde sistemas externos.
      // Las actualizaciones de estado reflejan IndexedDB, D1 y la sesión del Worker.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "app/driver-app.tsx",
      "app/level-one-suite.tsx",
      "app/turn-navigation-overlay.tsx",
    ],
    rules: {
      // Estos componentes se suscriben a GPS, red, DOM, reloj y síntesis de voz.
      // El estado se actualiza deliberadamente cuando cambian esos sistemas externos.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/level-one-suite.tsx"],
    rules: {
      // El panel genera instantáneas operativas fechadas para comparar jornadas.
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
