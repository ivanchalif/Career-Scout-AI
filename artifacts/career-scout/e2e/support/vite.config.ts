import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Separate config, never imported by the production build. Only identity is
// replaced: App, route ownership, query hooks, dialog and controls are real.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify("test-only"),
    "import.meta.env.VITE_CLERK_PROXY_URL": JSON.stringify(""),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "@clerk/react": fileURLToPath(new URL("./clerk.tsx", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  server: { host: "127.0.0.1", port: 5189, strictPort: true },
});
