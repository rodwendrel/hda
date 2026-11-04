/**
 * HDA: compila `src/packs/<pack>/*.json` em `packs/<pack>` (LevelDB), que é o
 * que o Foundry lê. Um JSON por documento, com os embutidos na própria árvore
 * (`results` de RollTable, `items` de Actor). Roda antes do `vite build`.
 *
 * `@foundryvtt/foundryvtt-cli` não serve aqui: a 3.0.5 quebra no Node 24 ao abrir
 * os packs. O formato de chaves é simples o bastante para escrever direto.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ClassicLevel } from 'classic-level';

const SOURCE = 'src/packs';
const EMBEDDED = { RollTable: ['tables', { results: 'results' }], Item: ['items', {}], Actor: ['actors', { items: 'items' }] };

function collectionOf(doc) {
  if ('formula' in doc && 'results' in doc) return 'RollTable';
  return 'items' in doc && 'prototypeToken' in doc ? 'Actor' : 'Item';
}

function writeDocument(batch, doc) {
  const [collection, children] = EMBEDDED[collectionOf(doc)];
  const copy = { ...doc };
  for (const field of Object.keys(children)) {
    copy[field] = doc[field].map((child) => child._id);
    for (const child of doc[field]) batch.put(`!${collection}.${field}!${doc._id}.${child._id}`, child);
  }
  batch.put(`!${collection}!${doc._id}`, copy);
}

for (const pack of readdirSync(SOURCE)) {
  const dir = join('packs', pack);
  rmSync(dir, { recursive: true, force: true });
  const db = new ClassicLevel(dir, { keyEncoding: 'utf8', valueEncoding: 'json' });
  await db.open();
  const batch = db.batch();
  const files = readdirSync(join(SOURCE, pack)).filter((file) => file.endsWith('.json'));
  for (const file of files) writeDocument(batch, JSON.parse(readFileSync(join(SOURCE, pack, file), 'utf8')));
  await batch.write();
  await db.close();
  console.log(`pack ${pack}: ${files.length}`);
}
