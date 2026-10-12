import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Khi phát triển, API và file publish do backend phục vụ ở cổng 8000; khi triển khai, nginx làm việc này.
const BACKEND = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": BACKEND, "/builds": BACKEND },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": BACKEND, "/builds": BACKEND },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
