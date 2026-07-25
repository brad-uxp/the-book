import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Vite no lee `paths` de tsconfig por su cuenta. Sin este alias, cualquier
    // test que toque lib/cron-helpers.ts o lib/run-daily.ts falla al importar
    // (`@/app/generated/prisma/enums`, `@/lib/db`) antes de ejecutar nada.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Lógica de negocio pura (currency, dates, cron-helpers…) → entorno node.
    // Cuando se agreguen tests de componentes React, cambiar a jsdom/happy-dom.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "app/generated"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.test.ts", "app/generated/**"],
    },
  },
});
