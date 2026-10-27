import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// 깃허브(GitHub) 푸시 및 빌드 시마다 service-worker.js의 CACHE_VERSION을 빌드 타임스탬프로 자동 갱신하는 플러그인
function autoServiceWorkerVersionPlugin() {
  return {
    name: 'auto-sw-version',
    writeBundle(options: any) {
      const outDir = options.dir || 'dist';
      const swPath = path.resolve(outDir, 'service-worker.js');
      const buildStamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const versionStr = `v1.41-${buildStamp}`;

      if (fs.existsSync(swPath)) {
        let content = fs.readFileSync(swPath, 'utf-8');
        content = content.replace(
          /const CACHE_VERSION = ['"][^'"]+['"];/,
          `const CACHE_VERSION = '${versionStr}';`
        );
        fs.writeFileSync(swPath, content, 'utf-8');
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
