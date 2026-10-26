import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { SplashScreen } from '@capacitor/splash-screen';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// inside the Android app: take the native splash away once the first screen is on the page (on the web this does nothing)
requestAnimationFrame(() => {
  void SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => undefined);
});
