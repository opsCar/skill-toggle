import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["async-cli/**", "node_modules/**", "dist/**"]
  }
});
