import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_DA_API = {
  '/api': {
    target: 'http://localhost:3333',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // O frontend nunca fala com o ingresso.com direto (§5.1): só com o backend.
    // O proxy evita CORS em dev e mantém o mesmo caminho /api em produção.
    proxy: PROXY_DA_API,
  },
  // `preview` tem config própria e NÃO herda a de `server`. Sem isto, testar o
  // build — que é a única forma honesta de testar o PWA, porque o service
  // worker só faz sentido sobre os assets com hash — dava 404 em todo `/api`.
  preview: {
    port: 4173,
    proxy: PROXY_DA_API,
  },
  css: {
    modules: {
      // .module.scss vira classe camelCase no TS: styles.posterCard
      localsConvention: 'camelCaseOnly',
      generateScopedName: '[name]__[local]__[hash:base64:5]',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
