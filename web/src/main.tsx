import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Register Service Worker in production builds (GitHub Pages & Flutter mode)
// to cache static assets for instant repeat loads.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // BASE_URL es '/' (teléfono) o '/wixplorer/' (GitHub Pages)
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {/* SW optional */});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
