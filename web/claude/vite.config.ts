import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: false,
    host: true,
    proxy: {
      '/api/session-import': 'http://127.0.0.1:8899',
      '/api': 'http://127.0.0.1:3001',
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true
      }
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
          'vendor-markdown': [
            'react-markdown',
            'rehype-highlight',
            'rehype-katex',
            'remark-gfm',
            'remark-math'
          ],
          'vendor-katex': ['katex']
        }
      }
    }
  }
});
