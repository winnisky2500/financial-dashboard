// vite.config.ts
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ConfigEnv } from 'vite';
import sourceIdentifierPlugin from 'vite-plugin-source-info';

export default defineConfig(({ mode }: ConfigEnv) => {
  // 正确加载 .env.* (含 .env.local / .env.development 等)
  const env = loadEnv(mode, process.cwd(), '');

  const isProd = mode === 'production' || env.BUILD_MODE === 'prod';

  // 兼容你的变量命名；没有则兜底到 18000
  const backend =
    env.VITE_ROE_AGENT_URL ||
    env.VITE_BACKEND_URL ||
    'http://127.0.0.1:18000';

  return {
    plugins: [
      react(),
      sourceIdentifierPlugin({
        enabled: !isProd,
        attributePrefix: 'data-matrix',
        includeProps: true,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // —— 开发服务：锁定 127.0.0.1:5173，修复 HMR WS 拒绝 —— 
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: {
        protocol: 'ws',
        host: '127.0.0.1',
        port: 5173,
      },
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
    // —— 生产预览同样锁端口，避免 WS 报错 —— 
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
  };
});
