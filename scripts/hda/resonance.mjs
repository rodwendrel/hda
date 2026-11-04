/** Conjurar (seção 6.4): calma, pressão, Forçar, Cicatriz, ajudantes, Anular, Ruptura. */
import { Damage } from '../damage.mjs';
import { settings, SYSTEM_ID } from '../settings.mjs';
import { cardFlags, postCard, postNotice, registerCardAction, updateCard } from './chat.mjs';
import { rollCurse } from './curses.mjs';
import {
  applyStabilityLoss, loseOn, payOn, postBreakCard, postLossCards, rollSum, snapshot, testWil, warnUnset,
} from './mind.mjs';
import { forceCost, halve, scarCost } from './rules.mjs';
import { onRelay, relay } from './socket.mjs';

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export const categoryLabel = (item) => t(`HDA.Category.${item.system.category}`);

const knowsByName = (actor, name) => actor.items.some((i) => i.type === 'manifestation' && i.name === name);

const scarByDefault = () => canvas.scene?.getFlag(SYSTEM_ID, 'scar') ?? false;

/** As Manifestações conhecidas e as dos Tomos equipados, como a aba as mostra. */
export async function resonanceList(actor) {
  const { awakened } = actor.system.mind;
  const row = (item, extra) => ({
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    categoryLabel: categoryLabel(item),
    costFormula: item.system.costFormula,
    requiresTrueName: item.system.requiresTrueName,
    viaTome: false,
    canCast: true,
    castHint: '',
    ...extra,
  });
  const rows = actor.items
    .filter((i) => i.type === 'manifestation')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => row(item, { canCast: awakened, castHint: awakened ? '' : t('HDA.CastHint') }));
  for (const tome of actor.items.filter((i) => i.type === 'spellbook' && i.system.equipped)) {
    const uuid = tome.system.manifestationUuid;
    const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (item) rows.push(row(item, { id: tome.id, viaTome: true }));
    else {
      rows.push({
        id: tome.id,
        name: tome.name,
        viaTome: true,
        canCast: false,
        castHint: t('HDA.EmptyTome'),
        categoryLabel: t('TYPES.Item.spellbook'),
        costFormula: '—',
      });
    }
  }
  return rows;
}

async function applyHpCost(actor, formula) {
  const roll = await rollSum(formula);
  const hp = actor.system.hp.value;
  const str = actor.system.abilities.STR.value;
  const { newHp, newStr } = Damage._calculateHpAndStr(roll.total, 0, hp, str);
  const strAfter = Math.max(0, newStr);
  await actor.update({ 'system.hp.value': newHp, 'system.abilities.STR.value': strAfter });
  const changes = [{ label: t('CAIRN.HitProtection'), from: hp, to: newHp }];
  if (strAfter !== str) changes.push({ label: t('STR'), from: str, to: strAfter });
  return { roll, changes, strSave: strAfter < str };
}

onRelay('heal', async ({ uuid, formula, lossFormula, source }) => {
  const target = await fromUuid(uuid);
  const roll = await rollSum(formula);
  const { value, max } = target.system.hp;
  const to = Math.min(max, value + roll.total);
  await target.update({ 'system.hp.value': to });
  await postNotice({
    title: source,
    changes: [{ label: t('CAIRN.HitProtection'), from: value, to }],
  }, { actor: target, rolls: [roll] });
  if (lossFormula) await loseOn(target, { formula: lossFormula, source });
});

/** Rola o efeito da Manifestação. Dano fica no cartão para o Guardião aplicar. */
async function resolveEffect(actor, item, targets) {
  const { effectType, effectFormula, ignoresArmor, healStabilityLoss } = item.system;
  if (!effectFormula || effectType === 'none') return;
  if (effectType === 'damage') {
    const roll = await rollSum(effectFormula, actor.getRollData());
    await Damage.postRoll(actor, roll, { label: item.name, targets, ignoreArmor: ignoresArmor });
    return;
  }
  const tokens = targets.map((id) => canvas.scene?.tokens.get(id)).filter(Boolean);
  const actors = tokens.length ? tokens.map((token) => token.actor) : [actor];
  for (const target of actors) {
    if (effectType === 'heal') {
      const payload = { uuid: target.uuid, formula: effectFormula, lossFormula: healStabilityLoss, source: item.name };
      await relay('heal', payload, target.isOwner);
    } else if (effectType === 'stabilityLoss') {
      await loseOn(target, { formula: effectFormula, source: item.name });
    }
  }
}

function stabilityLine(result) {
  return result ? { from: result.before.stability.value, to: result.next.stability.value } : null;
}

/**
 * Conjura. `helpers` conta os ajudantes (+1 cada); `helperActors` são os que
 * pagam metade. Só falha aqui o que a ficha já não deixaria clicar.
 */
export async function cast(actor, manifestation, {
  underPressure = false,
  helpers = 0,
  helperActors = [],
  inScar = scarByDefault(),
  viaTome = false,
  trueName = false,
  targets = [...game.user.targets].map((token) => token.id),
} = {}) {
  if (actor.system.mind.unset) {
    warnUnset(actor);
    return null;
  }
  if (!viaTome && !(actor.system.mind.awakened && knowsByName(actor, manifestation.name))) {
    ui.notifications.warn(t('HDA.CastHint'));
    return null;
  }

  const before = snapshot(actor);
  const { costFormula, hpCost: hpFormula, calmNoTest, requiresTrueName } = manifestation.system;
  const costRoll = await rollSum(costFormula);
  const rolls = [costRoll];
  let cost = costRoll.total;
  let scarRoll = null;
  if (inScar) {
    const d6 = await rollSum('1d6');
    scarRoll = d6.total;
    const extra = scarRoll === 6 ? await rollSum('2d6+6') : null;
    rolls.push(d6, extra);
    cost = scarCost(cost, scarRoll, extra?.total);
  }

  const loss = await applyStabilityLoss(actor, cost);
  const hpCost = hpFormula ? await applyHpCost(actor, hpFormula) : null;
  if (hpCost) rolls.push(hpCost.roll);

  const data = {
    name: manifestation.name,
    categoryLabel: categoryLabel(manifestation),
    costFormula,
    cost,
    viaTome,
    requiresTrueName,
    calm: !underPressure,
    inScar,
    scarRoll,
    helpers,
    helperCost: helperActors.length ? halve(cost) : 0,
    stability: stabilityLine(loss),
    attunementDelta: loss?.attunementDelta ? `+${loss.attunementDelta}` : '',
    attunement: loss?.next.attunement,
    hpChanges: hpCost?.changes,
    strSave: hpCost?.strSave,
    targets,
    outcome: 'happens',
  };

  const calmAllowed = settings.get('hda-calm-no-test') && calmNoTest;
  let cursed = false;
  if (underPressure || !calmAllowed) {
    const test = await testWil(actor, helpers + (trueName ? 2 : 0));
    rolls.push(test.roll);
    data.test = { target: test.target, natural: test.natural, success: test.success, critical: test.critical };
    cursed = test.critical && settings.get('hda-curse-on-nat20');
    if (cursed) data.outcome = 'curse';
    else if (!test.success) {
      data.outcome = 'failed';
      data.forceCost = forceCost(test.natural, test.target);
    }
  }

  const message = await postCard('cast', data, { actor, rolls, before, extra: { item: manifestation.uuid } });
  await postBreakCard(actor, loss);
  for (const helper of helperActors) await payOn(helper, halve(cost), t('HDA.HelperPays', { name: manifestation.name }));
  if (cursed) await rollCurse(actor, { cost, source: manifestation.name });
  if (data.outcome === 'happens') await resolveEffect(actor, manifestation, targets);
  return message;
}

/** Mantém o topo e a linha de resumo do diálogo em dia. */
function wireCastDialog(root) {
  const form = root.querySelector('form') ?? root.closest('form');
  const body = root.querySelector('.hda-cast');
  const update = () => {
    const option = form.elements.manifestation.selectedOptions[0];
    root.querySelector('.hda-ttl').textContent = option.dataset.name;
    root.querySelector('.hda-tag').textContent = option.dataset.category;
    const trueName = root.querySelector('.hda-true-name');
    trueName.hidden = option.dataset.trueName !== 'true';
    const payers = form.querySelectorAll('input[name="helper"]:checked').length;
    const helpers = Math.max(0, form.elements.extraHelpers.valueAsNumber || 0) + payers;
    const bonus = helpers + (!trueName.hidden && form.elements.trueName.checked ? 2 : 0);
    const noTest = form.elements.calm.checked && settings.get('hda-calm-no-test');
    const test = noTest ? t('HDA.CalmNoTest') : `${t('HDA.WilTest')} ${body.dataset.wil}${bonus ? ` +${bonus}` : ''}.`;
    const help = payers ? ` ${t('HDA.HelpersPayHalf')}` : '';
    root.querySelector('.hda-sum').textContent = `${test} ${t('HDA.Cost')} ${option.dataset.cost}.${help}`;
  };
  form.addEventListener('change', update);
  form.addEventListener('input', update);
  update();
}

/** O diálogo de conjurar. Abre com a Manifestação clicada, ou com a primeira. */
export async function castDialog(actor, uuid = null) {
  if (actor.system.mind.unset) {
    warnUnset(actor);
    return;
  }
  const rows = (await resonanceList(actor)).filter((row) => row.canCast);
  if (!rows.length) {
    ui.notifications.warn(t('HDA.CastHint'));
    return;
  }
  const selected = rows.find((row) => row.uuid === uuid) ?? rows[0];
  const controlled = canvas.tokens?.controlled.map((token) => token.actor).filter(Boolean) ?? [];
  const helpers = controlled.filter((a) => a.uuid !== actor.uuid && a.type === 'character' && knowsByName(a, selected.name));
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/dialog/cast.hbs`, {
    rows: rows.map((row) => ({ ...row, selected: row.uuid === selected.uuid })),
    single: rows.length === 1,
    inScar: scarByDefault(),
    helpers: helpers.map((a) => ({ uuid: a.uuid, name: a.name })),
    targets: [...game.user.targets].map((token) => token.name).join(', '),
    wil: actor.system.abilities.WIL.value,
  });

  const data = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.Cast') },
    position: { width: 420 },
    content,
    render: (_event, dialog) => wireCastDialog(dialog.element),
    ok: {
      label: t('HDA.Cast'),
      callback: (_event, button) => {
        const form = button.form.elements;
        const payers = [...button.form.querySelectorAll('input[name="helper"]:checked')].map((el) => el.value);
        return {
          uuid: form.manifestation.value,
          underPressure: !form.calm.checked,
          inScar: form.scar.checked,
          trueName: form.trueName.checked && !form.trueName.closest('[hidden]'),
          helpers: Math.max(0, form.extraHelpers.valueAsNumber || 0) + payers.length,
          payers,
        };
      },
    },
    rejectClose: false,
  });
  if (!data) return;

  const row = rows.find((r) => r.uuid === data.uuid);
  await cast(actor, await fromUuid(data.uuid), {
    underPressure: data.underPressure,
    inScar: data.inScar,
    trueName: data.trueName,
    viaTome: row.viaTome,
    helpers: data.helpers,
    helperActors: await Promise.all(data.payers.map((helper) => fromUuid(helper))),
  });
}

/** Ruptura: sem teste e sem falha. Quem digita o custo é o Guardião. */
export async function rupture(actor, formula = '2d6+6') {
  if (!actor.system.mind.awakened) {
    ui.notifications.warn(t('HDA.RuptureAwakenedOnly'));
    return;
  }
  const before = snapshot(actor);
  const roll = await rollSum(formula);
  const result = await applyStabilityLoss(actor, roll.total);
  if (!result) return;
  await postNotice({
    title: t('HDA.Rupture'),
    tag: formula,
    lines: [t('HDA.RuptureText')],
    changes: [{ label: t('HDA.Stability'), from: result.before.stability.value, to: result.next.stability.value }],
  }, { actor, rolls: [roll], before });
  await postBreakCard(actor, result);
}

export async function ruptureDialog(actor) {
  const formula = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.Rupture') },
    content: `<div class="form-group"><label>${t('HDA.Cost')}</label><input name="formula" type="text" value="2d6+6"></div>`,
    ok: { label: t('HDA.Rupture'), callback: (_event, button) => button.form.elements.formula.value.trim() },
    rejectClose: false,
  });
  if (formula) await rupture(actor, formula);
}

/** Personagens do usuário que podem Anular aquele cartão. */
function annulCandidates(message) {
  const flags = cardFlags(message);
  return game.actors.filter((a) => a.type === 'character' && a.isOwner && a.uuid !== flags.actor
    && a.system.mind.awakened && knowsByName(a, flags.data.name));
}

async function chooseAnnuller(candidates) {
  if (candidates.length === 1) return candidates[0];
  const options = candidates.map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`).join('');
  const id = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.Annul') },
    content: `<select name="actor">${options}</select>`,
    ok: { label: t('HDA.Annul'), callback: (_event, button) => button.form.elements.actor.value },
    rejectClose: false,
  });
  return id ? game.actors.get(id) : null;
}

registerCardAction('force', {
  run: async (message) => {
    const flags = cardFlags(message);
    if (flags.data.outcome !== 'failed') return;
    const actor = await fromUuid(flags.actor);
    const before = snapshot(actor);
    const loss = await applyStabilityLoss(actor, flags.data.forceCost, { countsForAttunement: false });
    if (!loss) return;
    await updateCard(message, { outcome: 'forced' });
    await postLossCards(actor, loss, { source: t('HDA.Force'), before });
    const item = await fromUuid(flags.item);
    if (item) await resolveEffect(actor, item, flags.data.targets ?? []);
  },
});

/* O botão "Dano de VON" no cartão de ataque do PNJ. */
registerCardAction('willDamage', {
  run: async (message) => {
    const flags = cardFlags(message);
    const actor = await fromUuid(flags.actor);
    const roll = await rollSum(actor.system.willAttack, actor.getRollData());
    const targets = flags.data.targets ? flags.data.targets.split(';') : [];
    await Damage.postRoll(actor, roll, { label: actor.name, ability: 'WIL', targets });
  },
});

registerCardAction('giveUp', {
  run: (message) => updateCard(message, { outcome: 'gaveUp' }),
});

registerCardAction('annul', {
  visible: (message) => !cardFlags(message).data.annulled && annulCandidates(message).length > 0,
  run: async (message) => {
    const annuller = await chooseAnnuller(annulCandidates(message));
    if (!annuller) return;
    const { data } = cardFlags(message);
    const before = snapshot(annuller);
    const loss = await applyStabilityLoss(annuller, data.cost);
    if (!loss) return;
    const test = await testWil(annuller);
    await postNotice({
      title: t('HDA.Annul'),
      tag: data.name,
      lines: [t(test.success ? 'HDA.AnnulSuccess' : 'HDA.AnnulFail', { natural: test.natural, target: test.target })],
      changes: [{ label: t('HDA.Stability'), from: loss.before.stability.value, to: loss.next.stability.value }],
    }, { actor: annuller, rolls: [test.roll], before });
    await postBreakCard(annuller, loss);
    if (test.success) await updateCard(message, { annulled: true });
  },
});
