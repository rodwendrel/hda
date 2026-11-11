/**
 * Criação do personagem do cenário (seção 6.6) e o despertar. Um d6 só dá a
 * Estabilidade (VON + d + 6) e decide o despertar: 6, ou 5 e 6 com Antecedente ◆.
 */
import { compendiumInfoFromString, findCompendiumItem } from '../compendium.mjs';
import { settings, SYSTEM_ID } from '../settings.mjs';
import { postNotice } from './chat.mjs';
import { rollSum } from './mind.mjs';
import { awakensWith, stabilityFromDie } from './rules.mjs';

const { DialogV2 } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Tabela do mundo que o usuário preenche; a de nomes galego-portugueses não vem no sistema. */
export const NAME_TABLE = 'Nomes de Herdeiros';
const STABILITY_DIE = '1d6';

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

/**
 * Quem desperta rola ou escolhe uma Sutil do pack. Fechar o diálogo rola:
 * o personagem não sai sem Manifestação.
 */
export async function chooseSubtle() {
  const pack = game.packs.get(`${SYSTEM_ID}.hda-manifestations`);
  const subtle = (await pack.getDocuments())
    .filter((item) => item.system.category === 'subtle')
    .sort((a, b) => a.name.localeCompare(b.name));
  const options = subtle.map((item) => `<option value="${item.id}">${foundry.utils.escapeHTML(item.name)}</option>`).join('');
  const choice = await DialogV2.wait({
    classes: ['hda-dialog'],
    window: { title: t('HDA.ChooseSubtle') },
    content: `<p>${t('HDA.ChooseSubtleText')}</p><select name="manifestation">${options}</select>`,
    buttons: [
      { action: 'roll', label: t('HDA.RollSubtle'), default: true },
      { action: 'choose', label: t('HDA.Choose'), callback: (_event, button) => button.form.elements.manifestation.value },
    ],
    rejectClose: false,
  });
  const chosen = subtle.find((item) => item.id === choice);
  if (chosen) return chosen;
  const roll = await rollSum(`1d${subtle.length}`);
  return subtle[roll.total - 1];
}

/** Carta de Integridade de quem desperta: nenhuma, falsa ou a verdadeira de antes. */
export async function chooseIntegrityCard() {
  const card = await DialogV2.wait({
    classes: ['hda-dialog'],
    window: { title: t('HDA.IntegrityCard') },
    content: `<p>${t('HDA.IntegrityCardText')}</p>`,
    buttons: ['none', 'forged', 'genuine'].map((value) => ({
      action: value,
      label: t(`HDA.Card${value[0].toUpperCase()}${value.slice(1)}Choice`),
      default: value === 'none',
    })),
    rejectClose: false,
  });
  return ['none', 'forged', 'genuine'].includes(card) ? card : 'none';
}

/** ◆ do Antecedente, pela tabela do pack. `null` se o Antecedente não está lá. */
async function backgroundAwakensOn5(name) {
  if (!name) return null;
  const table = await findCompendiumItem(`${SYSTEM_ID}.hda-backgrounds`, 'Antecedentes').catch(() => null);
  const result = table?.results.find((r) => r.name === name);
  return result ? Boolean(result.flags?.[SYSTEM_ID]?.awakensOn5) : null;
}

async function askDiamond(background) {
  return DialogV2.confirm({
    classes: ['hda-dialog'],
    window: { title: t('HDA.Awakening') },
    content: `<p>${t('HDA.AskDiamond', { background: foundry.utils.escapeHTML(background || '—') })}</p>`,
    rejectClose: false,
  });
}

/**
 * Botão "Rolar Estabilidade" da ficha: o mesmo d6 dá a Estabilidade e o
 * despertar. Quem desperta escolhe a Sutil e a Carta de Integridade.
 */
export async function rollStability(actor) {
  const roll = await rollSum(STABILITY_DIE);
  const d6 = roll.total;
  const wil = actor.system.abilities.WIL.max;
  const stability = stabilityFromDie(wil, d6);
  let diamond = false;
  if (d6 === 5) diamond = (await backgroundAwakensOn5(actor.system.background)) ?? (await askDiamond(actor.system.background));
  const wasAwakened = actor.system.mind.awakened;
  const awakened = wasAwakened || awakensWith(d6, diamond);
  await actor.update({
    'system.mind.stability.value': stability,
    'system.mind.stability.max': stability,
    'system.mind.awakened': awakened,
  });

  const lines = [t('HDA.StabilityRolled', { formula: `${wil} + ${d6} + 6`, total: stability })];
  if (awakened && !wasAwakened) lines.push(t('HDA.AwakensByDie', { d6 }));
  else if (!awakened) lines.push(t('HDA.NotAwakened'));
  await postNotice({ title: t('HDA.Stability'), lines }, { actor, rolls: [roll] });

  if (awakened && !wasAwakened) {
    const subtle = await chooseSubtle();
    if (subtle && !actor.items.some((i) => i.type === 'manifestation' && i.name === subtle.name)) {
      await actor.createEmbeddedDocuments('Item', [subtle.toObject()]);
    }
    await actor.update({ 'system.integrityCard': await chooseIntegrityCard() });
  }
  return stability;
}

/** Tudo o que o cenário acrescenta ao personagem, a partir dos atributos rolados. */
export async function rollHeir(config, abilities) {
  const background = await draw(config.background);
  const origin = await draw(config.origin);
  const backgroundFlags = background.flags[SYSTEM_ID] ?? {};
  const originFlags = origin.flags[SYSTEM_ID] ?? {};

  const silver = originFlags.silver ? (await rollSum(originFlags.silver)).total : 0;
  const d6 = (await rollSum(STABILITY_DIE)).total;
  const stability = stabilityFromDie(abilities.WIL, d6);
  const awakened = awakensWith(d6, backgroundFlags.awakensOn5);
  const items = [...(backgroundFlags.items ?? []), ...(originFlags.items ?? [])];
  let integrityCard = 'genuine';
  if (awakened) {
    items.push((await chooseSubtle()).toObject());
    integrityCard = await chooseIntegrityCard();
  }

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
    integrityCard,
    mind: { stability: { value: stability, max: stability }, awakened },
  };
}
