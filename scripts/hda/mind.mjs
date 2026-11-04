/** A mente: teste de VON, perda e recuperação de Estabilidade, Ressoar. */
import { SYSTEM_ID } from '../settings.mjs';
import { evaluateFormula } from '../utils.mjs';
import { cardFlags, lastUndoable, postCard, postNotice, registerCardAction, updateCard } from './chat.mjs';
import {
  breaksStability, computeLoss, computeRecovery, RESONATE_COST, resolveTest, stabilityBar,
} from './rules.mjs';
import { onRelay, relay } from './socket.mjs';

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Soma de verdade: `1d6+2` é 1d6 mais 2, nunca o maior dos dois (ver utils). */
export const rollSum = (formula, data) => evaluateFormula(formula, data, { sum: true });

export function readState(actor) {
  const { stability, attunement, insanity, lost } = actor.system.mind;
  return {
    stability: { value: stability.value, max: stability.max },
    attunement,
    insanity,
    lost,
    wil: actor.system.abilities.WIL.value,
  };
}

function stateUpdate(state) {
  return {
    'system.mind.stability.value': state.stability.value,
    'system.mind.stability.max': state.stability.max,
    'system.mind.attunement': state.attunement,
    'system.mind.insanity': state.insanity,
    'system.mind.lost': state.lost,
    'system.abilities.WIL.value': state.wil,
  };
}

/** O que `Desfazer` precisa para voltar atrás. */
export function snapshot(actor) {
  return {
    actor: actor.uuid,
    state: readState(actor),
    hp: actor.system.hp.value,
    str: actor.system.abilities.STR.value,
  };
}

export function warnUnset(actor) {
  ui.notifications.warn(t('HDA.Notify.RollStabilityFirst', { name: actor.name }));
}

export async function testWil(actor, bonus = 0) {
  const roll = await evaluateFormula('1d20');
  return { roll, ...resolveTest(roll.total, actor.system.abilities.WIL.value + bonus) };
}

/**
 * Aplica uma perda já calculada. Devolve `null` se a Estabilidade não foi
 * rolada. Quem chama decide o cartão: ver `postLossCards`.
 */
export async function applyStabilityLoss(actor, loss, { countsForAttunement = true } = {}) {
  if (actor.system.mind.unset) {
    warnUnset(actor);
    return null;
  }
  const state = readState(actor);
  const amount = Math.max(0, Math.floor(loss));
  const drop = breaksStability(state, amount) ? await rollSum('1d3') : null;
  const result = computeLoss(state, amount, { countsForAttunement, maxDrop: drop?.total ?? 0 });
  if (amount > 0) await actor.update(stateUpdate(result.next));
  return { ...result, before: state, drop };
}

/** Cartão de Insanidade, quando a perda zerou a Estabilidade. */
export async function postBreakCard(actor, result) {
  if (!result?.broke) return null;
  return postCard('insanity', {
    insanity: result.next.insanity,
    maxFrom: result.before.stability.max,
    maxTo: result.next.stability.max,
    overflow: result.overflow,
    wilFrom: result.before.wil,
    wilTo: result.next.wil,
    delirious: result.overflow > 0 && result.next.wil === 0,
    lost: result.next.lost && !result.before.lost,
    surtosLink: `@UUID[Compendium.${SYSTEM_ID}.hda-tables.RollTable.hdaSurtosFinais0]{${t('HDA.FinalBreaks')}}`,
  }, { actor, rolls: [result.drop] });
}

function stabilityData(result, { source, resisted }) {
  const from = result.before.stability.value;
  const to = result.broke ? 0 : result.next.stability.value;
  const max = result.before.stability.max;
  const delta = result.attunementDelta;
  return {
    source,
    resisted,
    from,
    to,
    max,
    bar: stabilityBar(from, to, max),
    attunementDelta: delta ? `+${delta}` : '',
    attunement: result.next.attunement,
  };
}

/** O cartão da perda e, se for o caso, o de Insanidade. */
export async function postLossCards(actor, result, { source, resisted, rolls = [], before } = {}) {
  if (!result) return;
  await postCard('stability', stabilityData(result, { source, resisted }), { actor, rolls, before });
  await postBreakCard(actor, result);
}

export async function loseStability(actor, { formula, resist = false, source = '' } = {}) {
  const before = snapshot(actor);
  const roll = await rollSum(formula);
  let loss = roll.total;
  const rolls = [roll];
  let resisted = false;
  if (resist) {
    const test = await testWil(actor);
    rolls.push(test.roll);
    resisted = test.success;
    if (resisted) loss = Math.floor(loss / 2);
  }
  const result = await applyStabilityLoss(actor, loss);
  await postLossCards(actor, result, { source: source || formula, resisted, rolls, before });
  return result;
}

export async function recoverStability(actor, formula = '1d3', source = t('HDA.WeekOfRest')) {
  if (actor.system.mind.unset) {
    warnUnset(actor);
    return null;
  }
  const roll = await rollSum(formula);
  const state = readState(actor);
  const { gain, next, attunementDelta } = computeRecovery(state, roll.total);
  await actor.update(stateUpdate(next));
  await postCard('stability', {
    source,
    from: state.stability.value,
    to: next.stability.value,
    max: next.stability.max,
    bar: stabilityBar(state.stability.value, next.stability.value, next.stability.max),
    attunementDelta: attunementDelta ? String(attunementDelta) : '',
    attunement: next.attunement,
  }, { actor, rolls: [roll] });
  return gain;
}

export async function rollStability(actor) {
  const roll = await rollSum('@abilities.WIL.max + 1d6 + 6', actor.getRollData());
  await actor.update({ 'system.mind.stability.value': roll.total, 'system.mind.stability.max': roll.total });
  await postNotice({
    title: t('HDA.Stability'),
    lines: [t('HDA.StabilityRolled', { formula: `${actor.system.abilities.WIL.max} + 1d6 + 6`, total: roll.total })],
  }, { actor, rolls: [roll] });
  return roll.total;
}

/** Ressoar (seção 6.5): perde 6, ganha +1 de Sintonia. Não gera a Sintonia da perda. */
export async function resonate(actor, { confirm = true } = {}) {
  if (confirm) {
    const proceed = await DialogV2.confirm({
      classes: ['hda-dialog'],
      window: { title: t('HDA.Resonate') },
      content: `<p>${t('HDA.ResonateConfirm')}</p>`,
      rejectClose: false,
    });
    if (!proceed) return null;
  }
  const before = snapshot(actor);
  const result = await applyStabilityLoss(actor, RESONATE_COST, { countsForAttunement: false });
  if (!result) return null;
  const attunement = actor.system.mind.attunement + 1;
  await actor.update({ 'system.mind.attunement': attunement, 'system.mind.resonating': true });
  result.next.attunement = attunement;
  result.attunementDelta += 1;
  await postLossCards(actor, result, { source: t('HDA.Resonate'), before });
  ui.notifications.info(t('HDA.Notify.Resonating', { name: actor.name }));
  return result;
}

/** Fim da cena: ninguém mais está ressoando. A Sintonia fica. */
export async function endScene() {
  const characters = game.actors.filter((a) => a.type === 'character' && a.system.mind.resonating);
  for (const actor of characters) await actor.update({ 'system.mind.resonating': false });
  ui.notifications.info(t('HDA.Notify.SceneEnded'));
}

export async function awaken(actor) {
  await actor.update({ 'system.mind.awakened': true });
  await postNotice({ title: t('HDA.Awakened'), lines: [t('HDA.AwakenedText', { name: actor.name })] }, { actor });
}

/** Noite sem abrigo quente: Privado e 1 Fadiga. Quem é dos Bosques Pálidos não cansa de frio. */
export async function coldNight(actor) {
  const hardened = actor.system.origin === 'Bosques Pálidos';
  await actor.update({ 'system.deprived': true });
  if (!hardened) await actor.createOwnedItem({ name: t('CAIRN.Fatigue'), type: 'item' });
  await postNotice({
    title: t('HDA.ColdNight'),
    lines: [t(hardened ? 'HDA.ColdNightHardened' : 'HDA.ColdNightText', { name: actor.name })],
  }, { actor });
}

/** Evolução opcional: 3d6 por atributo; se maior que o máximo, +1. */
export async function advance(actor) {
  const update = {};
  const rolls = [];
  const changes = [];
  for (const key of ['STR', 'DEX', 'WIL']) {
    const ability = actor.system.abilities[key];
    const roll = await rollSum('3d6');
    rolls.push(roll);
    const raised = roll.total > ability.max;
    if (raised) {
      update[`system.abilities.${key}.max`] = ability.max + 1;
      update[`system.abilities.${key}.value`] = ability.value + 1;
    }
    changes.push({ label: `${t(key)} (3d6 = ${roll.total})`, from: ability.max, to: raised ? ability.max + 1 : ability.max });
  }
  await actor.update(update);
  await postNotice({ title: t('HDA.Advancement'), changes }, { actor, rolls });
}

/** Perda em ator de outro jogador passa pelo Guardião. */
export const loseOn = (actor, data) => relay('lose', { uuid: actor.uuid, ...data }, actor.isOwner);

onRelay('lose', async ({ uuid, ...data }) => loseStability(await fromUuid(uuid), data));

/** Cobra um valor pronto (metade do ajudante, preço do outro). */
export const payOn = (actor, amount, source) => relay('pay', { uuid: actor.uuid, amount, source }, actor.isOwner);

onRelay('pay', async ({ uuid, amount, source }) => {
  const actor = await fromUuid(uuid);
  const before = snapshot(actor);
  await postLossCards(actor, await applyStabilityLoss(actor, amount), { source, before });
});

/** Diálogo de perda, com a tabela de Exposição como atalhos. */
export async function loseStabilityDialog(actors, { formula = '', source = '' } = {}) {
  const targets = actors.filter((a) => a?.type === 'character');
  if (!targets.length) {
    ui.notifications.warn(t('HDA.Notify.SelectCharacter'));
    return;
  }
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/dialog/lose-stability.hbs`, {
    names: targets.map((a) => a.name).join(', '),
    exposures: CONFIG.Cairn.exposures.map((e) => ({ ...e, label: t(e.label) })),
    formula,
    source,
  });
  const data = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.LoseStability') },
    content,
    ok: {
      label: t('HDA.Apply'),
      callback: (_event, button) => {
        const form = button.form.elements;
        return {
          formula: form.formula.value.trim() || form.exposure.value,
          source: form.source.value.trim() || form.exposure.selectedOptions[0]?.dataset.label || '',
          resist: form.resist.checked,
        };
      },
    },
    rejectClose: false,
  });
  if (!data?.formula) return;
  for (const actor of targets) await loseOn(actor, data);
}

/* Desfazer: só o Guardião, só a última perda do personagem. */
registerCardAction('undo', {
  visible: (message) => {
    const flags = cardFlags(message);
    return game.user.isGM && Boolean(flags.before) && !flags.undone && lastUndoable(flags.before.actor)?.id === message.id;
  },
  run: async (message) => {
    const { before } = cardFlags(message);
    // O botão de um cartão antigo fica visível até ele ser redesenhado.
    if (lastUndoable(before.actor)?.id !== message.id) {
      ui.notifications.warn(t('HDA.Notify.UndoLastOnly'));
      return;
    }
    const actor = await fromUuid(before.actor);
    await actor.update({
      ...stateUpdate(before.state),
      'system.hp.value': before.hp,
      'system.abilities.STR.value': before.str,
    });
    await updateCard(message, { undone: true }, { undone: true });
  },
});
