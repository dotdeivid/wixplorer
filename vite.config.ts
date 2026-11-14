import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Emite dist/asset-manifest.json con todos los archivos de assets/ del build,
 * incluidos los chunks que se cargan bajo demanda (jszip, pdf-lib) y que no
 * aparecen en index.html. El service worker lo usa para borrar del caché los
 * assets de builds anteriores.
 */
function assetManifest(): Plugin {
  return {
    name: 'wixplorer-asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter(name => name.startsWith('assets/'))
        .map(name => `/${name}`)
        .sort();
      this.emitFile({
        type: 'asset',
        fileName: 'asset-manifest.json',
        source: JSON.stringify(files),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), assetManifest()],
})
