import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import sourceIdentifierPlugin from "vite-plugin-source-info";

const isProd = process.env.BUILD_MODE === "prod";
// 后端地址可用环境变量覆盖，默认走本机 18000
const backend = process.env.VITE_ROE_AGENT_URL || "http://localhost:18000";

export default defineConfig({
  plugins: [
    react(),
    sourceIdentifierPlugin({
      enabled: !isProd,
      attributePrefix: "data-matrix",
      includeProps: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
