/** A API em `game.herdeiros`, para macros do Guardião. */
import { SYSTEM_ID } from '../settings.mjs';
import { rollCurse } from './curses.mjs';
import {
  advance, awaken, coldNight, endScene, loseStability, loseStabilityDialog, recoverStability, resonate, rollStability,
} from './mind.mjs';
import { cast, castDialog, rupture } from './resonance.mjs';

/** A perda em vários tokens selecionados. */
const horror = () => loseStabilityDialog(canvas.tokens?.controlled.map((token) => token.actor) ?? []);

/** Liga ou desliga a Cicatriz na cena atual. */
async function toggleScar() {
  const { scene } = canvas;
  if (!scene) return;
  const value = !scene.getFlag(SYSTEM_ID, 'scar');
  await scene.setFlag(SYSTEM_ID, 'scar', value);
  ui.notifications.info(game.i18n.localize(value ? 'HDA.Notify.ScarOn' : 'HDA.Notify.ScarOff'));
}

/**
 * Seção 8.2: o tipo continua `spellbook`, então o rótulo já é Tomo. Sobra
 * trocar os nomes genéricos que os mundos Cairn trouxeram.
 */
async function convertSpellbooks() {
  const generic = /^(spellbook|livro de feiti[cç]o|livro de magias)\b\s*:?\s*/i;
  const owned = game.actors.contents.flatMap((actor) => actor.items.contents);
  const books = [...game.items.contents, ...owned].filter((item) => item.type === 'spellbook' && generic.test(item.name));
  for (const item of books) {
    const rest = item.name.replace(generic, '');
    await item.update({ name: rest ? `Tomo: ${rest}` : 'Tomo' });
  }
  ui.notifications.info(game.i18n.format('HDA.Notify.Converted', { count: books.length }));
  return books.length;
}

export const api = {
  advance,
  awaken,
  cast,
  castDialog,
  coldNight,
  convertSpellbooks,
  endScene,
  horror,
  loseStability,
  loseStabilityDialog,
  recoverStability,
  resonate,
  rollCurse,
  rollStability,
  rupture,
  toggleScar,
};
