import { defineConfig } from "vitest/config";

// Unit tests run in plain Node, without the Cloudflare Vite plugin.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
