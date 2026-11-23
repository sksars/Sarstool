import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function copyIfExists(src: string, dest: string) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, {recursive: true, force: true});
  }
}

export default defineConfig(() => {
  return {
    plugins: [
      {
        name: 'copy-static-flyai-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) {
            return;
          }
          copyIfExists(path.resolve(__dirname, 'assets'), path.resolve(distDir, 'assets'));
          copyIfExists(path.resolve(__dirname, 'manifest.webmanifest'), path.resolve(distDir, 'manifest.webmanifest'));
          copyIfExists(path.resolve(__dirname, 'sw.js'), path.resolve(distDir, 'sw.js'));
          copyIfExists(path.resolve(__dirname, 'ads.txt'), path.resolve(distDir, 'ads.txt'));
          copyIfExists(path.resolve(__dirname, 'robots.txt'), path.resolve(distDir, 'robots.txt'));
          copyIfExists(path.resolve(__dirname, 'sitemap.xml'), path.resolve(distDir, 'sitemap.xml'));
        },
      },
    ],
    build: {
      target: 'es2022',
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
