import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Emite dist/asset-manifest.json con todos los archivos de assets/ del build,
 * incluidos los chunks que se cargan bajo demanda (jszip, pdf-lib) y que no
 * aparecen en index.html. El service worker lo usa para borrar del caché los
 * assets de builds anteriores.
 */
function assetManifest(): Plugin {
  let base = '/';
  return {
    name: 'wixplorer-asset-manifest',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      // Rutas absolutas tal como las pide el navegador (con la base de GitHub Pages)
      const files = Object.keys(bundle)
        .filter(name => name.startsWith('assets/'))
        .map(name => `${base}${name}`)
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
  // Ruta donde se sirve la app. '/' para el teléfono y Vite; GitHub Pages
  // (sin dominio propio) la sirve en /wixplorer/ y el workflow pasa
  // VITE_BASE=/wixplorer/.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), assetManifest()],
  define: {
    // Versión de package.json, para mostrarla en "Acerca de"
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
