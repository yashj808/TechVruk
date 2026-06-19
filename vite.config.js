import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'fabric', 'jszip', 'file-saver'],
  },
});
