import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/pdf-extract.mjs", "src/migrate.ts", "src/bootstrap-admin.ts", "src/recover-admin.ts", "src/maintain-admin.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: ["@stash/db", "@stash/core", "@stash/shared"],
  splitting: false,
});
