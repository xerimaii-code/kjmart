import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// 깃허브(GitHub) 푸시 및 빌드 시마다 service-worker.js의 CACHE_VERSION을 자동 갱신하고 PWA 아이콘/매니페스트 누락을 방지하는 플러그인
function autoServiceWorkerVersionPlugin() {
  return {
    name: 'auto-sw-version',
    writeBundle(options: any) {
      const outDir = options.dir || 'dist';
      const swPath = path.resolve(outDir, 'service-worker.js');
      const buildStamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const versionStr = `v1.42-${buildStamp}`;

      if (fs.existsSync(swPath)) {
        let content = fs.readFileSync(swPath, 'utf-8');
        content = content.replace(
          /const CACHE_VERSION = ['"][^'"]+['"];/,
          `const CACHE_VERSION = '${versionStr}';`
        );
        fs.writeFileSync(swPath, content, 'utf-8');
      }

      // PWA 아이콘(dist/icons/icon192.png, icon512.png)이 빌드 결과물에 100% 포함되도록 보장
      const distIconsDir = path.resolve(outDir, 'icons');
      if (!fs.existsSync(distIconsDir)) {
        fs.mkdirSync(distIconsDir, { recursive: true });
      }
      for (const iconFile of ['icon192.png', 'icon512.png']) {
        const destIcon = path.resolve(distIconsDir, iconFile);
        if (!fs.existsSync(destIcon)) {
          const srcCandidate1 = path.resolve('public/icons', iconFile);
          const srcCandidate2 = path.resolve('icons', iconFile);
          if (fs.existsSync(srcCandidate1)) {
            fs.copyFileSync(srcCandidate1, destIcon);
          } else if (fs.existsSync(srcCandidate2)) {
            fs.copyFileSync(srcCandidate2, destIcon);
          }
        }
      }

      const versionJsonPath = path.resolve(outDir, 'version.json');
      fs.writeFileSync(
        versionJsonPath,
        JSON.stringify({ version: versionStr, builtAt: new Date().toISOString() }, null, 2),
        'utf-8'
      );
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), autoServiceWorkerVersionPlugin()],
});
