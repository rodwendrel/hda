/** Gerador de personagem do cenário (seção 6.6). */
import { compendiumInfoFromString, findCompendiumItem } from '../compendium.mjs';
import { settings, SYSTEM_ID } from '../settings.mjs';
import { evaluateFormula } from '../utils.mjs';
import { rollSum } from './mind.mjs';

const { DialogV2 } = foundry.applications.api;

const t = (key) => game.i18n.localize(key);

/** Tabela do mundo que o usuário preenche; a de nomes galego-portugueses não vem no sistema. */
export const NAME_TABLE = 'Nomes de Herdeiros';

async function draw(reference) {
  const [compendium, name] = compendiumInfoFromString(reference);
  const table = await findCompendiumItem(compendium, name);
  const { results } = await table.draw({ displayChat: false });
  return results[0];
}

/** Nome da tabela do mundo, quando ligada; sem ela, `null` e vale o padrão do Cairn. */
export async function rollHeirName() {
  if (!settings.get('hda-use-name-table')) return null;
  const table = game.tables.getName(NAME_TABLE);
  if (!table) {
    ui.notifications.warn(game.i18n.format('HDA.Notify.NoNameTable', { name: NAME_TABLE }));
    return null;
  }
  const { results } = await table.draw({ displayChat: false });
  return results[0]?.name || results[0]?.description || null;
}

async function chooseSubtle() {
  const pack = game.packs.get(`${SYSTEM_ID}.hda-manifestations`);
  const subtle = (await pack.getDocuments()).filter((item) => item.system.category === 'subtle');
  const options = subtle.map((item) => `<option value="${item.id}">${foundry.utils.escapeHTML(item.name)}</option>`).join('');
  const id = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.ChooseSubtle') },
    content: `<p>${t('HDA.ChooseSubtleText')}</p><select name="manifestation">${options}</select>`,
    ok: { label: t('HDA.Choose'), callback: (_event, button) => button.form.elements.manifestation.value },
    rejectClose: false,
  });
  // Quem fecha o diálogo sem escolher fica com a primeira: o personagem não sai sem Sutil.
  return subtle.find((item) => item.id === id) ?? subtle[0];
}

/** Tudo o que o cenário acrescenta ao personagem, a partir dos atributos rolados. */
export async function rollHeir(config, abilities) {
  const background = await draw(config.background);
  const origin = await draw(config.origin);
  const backgroundFlags = background.flags[SYSTEM_ID] ?? {};
  const originFlags = origin.flags[SYSTEM_ID] ?? {};

  const silver = originFlags.silver ? (await rollSum(originFlags.silver)).total : 0;
  const stability = (await rollSum(config.stability, { WIL: abilities.WIL })).total;
  const awakened = backgroundFlags.awakened || (await evaluateFormula(config.awakeningDie)).total === 6;
  const items = [...(backgroundFlags.items ?? []), ...(originFlags.items ?? [])];
  if (awakened) items.push((await chooseSubtle()).toObject());

  const biography = [
    `<p><strong>${background.name}.</strong> ${background.description}</p>`,
    `<p><strong>${origin.name}.</strong> ${origin.description}</p>`,
  ].join('');

  return {
    background: background.name,
    origin: origin.name,
    biography,
    silver,
    items,
    mind: { stability: { value: stability, max: stability }, awakened },
  };
}
