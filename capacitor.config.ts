
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kjmart.app',
  appName: 'KJ Mart',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    Filesystem: {
      android: {
        permissions: ["android.permission.WRITE_EXTERNAL_STORAGE"]
      }
    }
  }
};

export default config;
