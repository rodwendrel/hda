/**
 * HDA: reescreve os packs LevelDB do upstream para o id `herdeiros`.
 *
 * Os packs guardam o id do sistema em texto: `Compendium.cairn.*`,
 * `systems/cairn/tokens/*`, `documentCollection: cairn.*`, `_stats.systemId`.
 * Depois de um merge com o upstream que traga packs novos, rode
 * `npm run packs:rebrand` de novo. É idempotente.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ClassicLevel } from 'classic-level';

const REPLACEMENTS = [
  [/systems\/cairn\//g, 'systems/herdeiros/'],
  [/Compendium\.cairn\./g, 'Compendium.herdeiros.'],
  [/"systemId":\s*"cairn"/g, '"systemId":"herdeiros"'],
  [/"cairn\.([a-z][a-z-]*)"/g, '"herdeiros.$1"'],
  [/"cairn":\s*\{/g, '"herdeiros":{'],
];

const root = 'packs';
const packs = readdirSync(root).filter((name) => !name.startsWith('hda-') && statSync(join(root, name)).isDirectory());
const leftovers = new Set();
let changed = 0;

for (const pack of packs) {
  const db = new ClassicLevel(join(root, pack), { keyEncoding: 'utf8', valueEncoding: 'utf8' });
  await db.open();
  const batch = db.batch();
  for await (const [key, value] of db.iterator()) {
    let text = value;
    for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
    if (text !== value) {
      batch.put(key, text);
      changed += 1;
    }
    for (const match of text.match(/.{0,30}\bcairn\b.{0,30}/gi) ?? []) {
      if (/\bcairn\.[a-z]|systems\/cairn|Compendium\.cairn/.test(match)) leftovers.add(`${pack}: ${match}`);
    }
  }
  await batch.write();
  await db.compactRange('\u0000', '\uffff');
  await db.close();
  console.log(`rebrand: ${pack}`);
}

console.log(`${changed} documentos reescritos`);
for (const line of leftovers) console.warn(`AVISO, referência restante: ${line}`);
