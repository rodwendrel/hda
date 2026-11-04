import vttforge from '@vttforge/vite-plugin';
import { defineConfig } from 'vite';

// Bundles scripts/main.mjs into dist/main.mjs, copies system.json, lang/,
// templates/, css/ and packs/, and syncs the version. dist/ is what ships.
// HDA: tokens/ e assets/ entram na lista; o padrão do plugin não os copia (as fontes vão pelo CSS).
export default defineConfig({
  plugins: [vttforge({ id: 'herdeiros', staticAssets: ['lang', 'templates', 'packs', 'tokens', 'assets'] })],
});
