import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/anton/400.css';
import '@fontsource-variable/oswald';
import './styles.css';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadAssets } from './assets';
import { preloadSounds } from './audio/sounds';
import { voice } from './voice/realtime';

void loadAssets().then(() => preloadSounds());
void voice.checkAvailable();

window.addEventListener('unhandledrejection', (e) => console.error('Unhandled', e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
