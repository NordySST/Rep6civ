import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import './styles.css';
import { App } from './ui/app';
import { T } from './ui/strings';

const root = document.getElementById('app')!;
const app = new App(root);
app.start();

// PWA: registra o service worker apenas em produção
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'activated' && !navigator.serviceWorker.controller) app.toast(T.offlineReady);
          });
        });
      })
      .catch(() => {});
  });
}
