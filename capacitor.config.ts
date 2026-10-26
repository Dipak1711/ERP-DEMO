import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.everest.forgeflow',
  appName: 'ForgeFlow ERP',
  webDir: 'dist',
  android: { backgroundColor: '#f6f8fb' },
  plugins: {
    SplashScreen: {
      // The native splash is just the logo, held for a moment; the web loading screen (index.html: same logo in the same place, with
      // a small loader under it) takes over from it, so the logo never jumps. The loader itself is drawn by the web page.
      launchAutoHide: true,
      launchShowDuration: 500,
      launchFadeOutDuration: 200,
      backgroundColor: '#f6f8fb',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
};

export default config;
