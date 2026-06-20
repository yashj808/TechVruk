import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id) return;
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('fabric')) return 'fabric';
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    },
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'fabric', 'jszip', 'file-saver'],
  },
  plugins: [
    visualizer({ filename: 'dist/bundle-stats.html', open: false })
  ]
});
