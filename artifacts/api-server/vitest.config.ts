import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    alias: {
      "@workspace/integrations-openai-ai-server": new URL(
        "../../lib/integrations-openai-ai-server/src/index.ts",
        import.meta.url,
      ).pathname,
      "@workspace/db": new URL("../../lib/db/src/index.ts", import.meta.url)
        .pathname,
      "@workspace/api-zod": new URL(
        "../../lib/api-zod/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
