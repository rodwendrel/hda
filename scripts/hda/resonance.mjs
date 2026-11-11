/**
 * Conjurar (seção 6.4). Sutis e Manifestas têm intensidade (Contida, Plena,
 * Desmedida) e um dado só: o mesmo resultado é o efeito e o custo. Falhar no
 * teste não impede a Manifestação: Forçar paga a diferença, deixar escapar traz
 * uma complicação. Só o 20 natural falha de verdade, com Maldição.
 */
import { Damage } from '../damage.mjs';
import { settings, SYSTEM_ID } from '../settings.mjs';
import { cardFlags, htmlToText, ownsCard, postCard, postNotice, registerCardAction, updateCard } from './chat.mjs';
import { rollCurse } from './curses.mjs';
import {
  applyStabilityLoss, loseOn, payOn, postBreakCard, postLossCards, rollSum, snapshot, testWil, warnUnset,
} from './mind.mjs';
import {
  attributeDamage, castCost, complicationFor, costLabel, fillDice, forceCost, halve, healSplit, INTENSITIES, scarCost,
  VIOLENT_DICE,
} from './rules.mjs';
import { onRelay, relay } from './socket.mjs';

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export const categoryLabel = (item) => t(`HDA.Category.${item.system.category}`);
const intensityLabel = (intensity) => (intensity ? t(`HDA.Intensity.${intensity}`) : '');

const knowsByName = (actor, name) => actor.items.some((i) => i.type === 'manifestation' && i.name === name);

const scarByDefault = () => canvas.scene?.getFlag(SYSTEM_ID, 'scar') ?? false;

/** O que o item pede além do efeito: arma vibrando (Lâmina Cinética) e botões no cartão (Apagar o Fogo). */
const itemFlags = (item) => item.flags?.[SYSTEM_ID] ?? {};

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
    violent: item.system.violent,
    dice: item.system.dice,
    costBonus: item.system.costBonus,
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

/* ---- Custos que não são Estabilidade ----------------------------------- */

/** Sangria: PG de quem conjura; se faltar, sai da FOR. */
async function applyHpCost(actor, amount) {
  const hp = actor.system.hp.value;
  const str = actor.system.abilities.STR.value;
  const { newHp, newStr } = Damage._calculateHpAndStr(amount, 0, hp, str);
  const strAfter = Math.max(0, newStr);
  await actor.update({ 'system.hp.value': newHp, 'system.abilities.STR.value': strAfter });
  const changes = [{ label: t('CAIRN.HitProtection'), from: hp, to: newHp }];
  if (strAfter !== str) changes.push({ label: t('STR'), from: str, to: strAfter });
  return { changes, strSave: strAfter < str };
}

/** Fadiga como o upstream faz: um item com o nome de `CAIRN.Fatigue`. */
export const addFatigue = (actor) => relay('fatigue', { uuid: actor.uuid }, actor.isOwner);

onRelay('fatigue', async ({ uuid }) => {
  const actor = await fromUuid(uuid);
  await actor.createOwnedItem({ name: t('CAIRN.Fatigue'), type: 'item' });
});

/* ---- Efeitos ----------------------------------------------------------- */

function targetActors(targets, fallback) {
  const tokens = (targets ?? []).map((id) => canvas.scene?.tokens.get(id)).filter(Boolean);
  return tokens.length ? tokens.map((token) => token.actor).filter(Boolean) : fallback;
}

/** Dano de DES ou VON (seção 6.3a), direto no atributo. */
onRelay('attributeDamage', async ({ uuid, key, amount, text, source }) => {
  const target = await fromUuid(uuid);
  const ability = target.system.abilities[key];
  const result = attributeDamage(ability.value, ability.max, amount);
  await target.update({ [`system.abilities.${key}.value`]: result.after });
  const lines = [];
  if (result.triggered && text) lines.push(text);
  if (result.zero) lines.push(t(key === 'DEX' ? 'HDA.Paralyzed' : 'HDA.Delirious'));
  else if (!result.triggered) lines.push(t('HDA.AttributeDamageOnly'));
  await postNotice({
    title: source,
    tag: t(key === 'DEX' ? 'HDA.DexDamage' : 'HDA.WillDamage'),
    lines,
    changes: [{ label: t(key), from: result.before, to: result.after }],
  }, { actor: target });
});

/** Remendo: PG cheios, pontos de FOR e DES de volta, e o curado perde Estabilidade. */
onRelay('heal', async ({ uuid, points, toStr, source }) => {
  const target = await fromUuid(uuid);
  const { hp, abilities } = target.system;
  const update = { 'system.hp.value': hp.max };
  const changes = [{ label: t('CAIRN.HitProtection'), from: hp.value, to: hp.max }];
  if (points > 0) {
    const healed = healSplit({ str: abilities.STR, dex: abilities.DEX }, points, toStr);
    update['system.abilities.STR.value'] = healed.str;
    update['system.abilities.DEX.value'] = healed.dex;
    if (healed.str !== abilities.STR.value) changes.push({ label: t('STR'), from: abilities.STR.value, to: healed.str });
    if (healed.dex !== abilities.DEX.value) changes.push({ label: t('DEX'), from: abilities.DEX.value, to: healed.dex });
  }
  await target.update(update);
  await postNotice({ title: source, changes }, { actor: target });
});

/** Quantos pontos do Remendo vão para a FOR; o resto vai para a DES. */
async function chooseHealSplit(target, points) {
  const { STR, DEX } = target.system.abilities;
  const room = { str: STR.max - STR.value, dex: DEX.max - DEX.value };
  if (!room.str || !room.dex) return room.str ? points : 0;
  const toStr = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.HealSplit') },
    content: `<p>${t('HDA.HealSplitText', { name: foundry.utils.escapeHTML(target.name), points })}</p>
      <label class="hda-counter">${t('STR')} (${STR.value}/${STR.max})
        <input type="number" name="toStr" min="0" max="${Math.min(points, room.str)}" value="${Math.min(points, room.str)}"></label>
      <p class="hda-lab">${t('DEX')} (${DEX.value}/${DEX.max}): ${t('HDA.HealSplitRest')}</p>`,
    ok: { label: t('HDA.Apply'), callback: (_event, button) => button.form.elements.toStr.valueAsNumber || 0 },
    rejectClose: false,
  });
  return toStr ?? Math.min(points, room.str);
}

/** Lâmina Cinética: a arma ignora a Armadura por um golpe ou por rodadas; a Desmedida aprimora o primeiro. */
async function setBlade(actor, intensity, effect) {
  const combat = game.combat?.started ? game.combat : null;
  const blade = intensity === 'contained'
    ? { hits: 1 }
    : { combat: combat?.id ?? null, until: combat ? combat.round + effect : null, enhanced: intensity === 'unbound' };
  await actor.setFlag(SYSTEM_ID, 'blade', blade);
}

/**
 * Chamado na rolagem de dano de arma do personagem. Devolve o que vale para
 * este golpe e gasta o que é de um uso só.
 */
export async function useBlade(actor) {
  const blade = actor.getFlag(SYSTEM_ID, 'blade');
  if (!blade) return null;
  const expired = blade.until !== null && blade.until !== undefined
    && (game.combat?.id !== blade.combat || game.combat.round > blade.until);
  if (expired) {
    await actor.unsetFlag(SYSTEM_ID, 'blade');
    return null;
  }
  const strike = { ignoreArmor: true, enhanced: Boolean(blade.enhanced) };
  if (blade.hits) await actor.unsetFlag(SYSTEM_ID, 'blade');
  else if (blade.enhanced) await actor.setFlag(SYSTEM_ID, 'blade', { ...blade, enhanced: false });
  return strike;
}

/**
 * Aplica o efeito já rolado. `effect` é o resultado do dado da intensidade;
 * nunca se rola de novo. `targets`: ids de token.
 */
async function applyEffect(actor, item, { intensity, effect, targets }) {
  const { effectType, ignoresArmor, effectText } = item.system;
  if (itemFlags(item).blade) await setBlade(actor, intensity, effect);
  if (effectType === 'none' || effect === null || effect === undefined) return;
  const text = fillDice(effectText?.[intensity], effect);

  if (effectType === 'damage') {
    const roll = await new Roll(String(effect)).evaluate();
    await Damage.postRoll(actor, roll, { label: item.name, targets, ignoreArmor: ignoresArmor });
    return;
  }
  const actors = targetActors(targets, effectType === 'heal' ? [actor] : []);
  if (!actors.length) {
    ui.notifications.warn(t('HDA.Notify.NoTargetForEffect', { name: item.name }));
    return;
  }
  for (const target of actors) {
    if (effectType === 'dexDamage' || effectType === 'wilDamage') {
      const key = effectType === 'dexDamage' ? 'DEX' : 'WIL';
      // O aviso escapa HTML nas linhas: vai o texto puro.
      const plain = htmlToText(text);
      await relay('attributeDamage', { uuid: target.uuid, key, amount: effect, text: plain, source: item.name }, target.isOwner);
    } else if (effectType === 'heal') {
      const points = intensity === 'contained' ? 0 : effect;
      const toStr = points ? await chooseHealSplit(target, points) : 0;
      await relay('heal', { uuid: target.uuid, points, toStr, source: item.name }, target.isOwner);
      if (target.type === 'character') await loseOn(target, { formula: String(effect), source: item.name });
    } else if (effectType === 'stabilityLoss' && target.type === 'character') {
      await loseOn(target, { formula: String(effect), source: item.name });
    }
  }
}

function stabilityLine(result) {
  return result ? { from: result.before.stability.value, to: result.next.stability.value } : null;
}

/**
 * Conjura. `intensity` vale para Sutis e Manifestas; as Violentas a ignoram.
 * `helpers` conta os ajudantes (+1 cada); `helperActors` são os que pagam metade.
 */
export async function cast(actor, manifestation, {
  intensity = 'full',
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

  const system = manifestation.system;
  const level = system.violent ? null : (INTENSITIES.includes(intensity) ? intensity : 'full');
  // A Contida nunca testa.
  const pressured = level !== 'contained' && underPressure;
  const before = snapshot(actor);

  const die = level ? system.dice[level] : VIOLENT_DICE;
  const dieRoll = await rollSum(die);
  const rolls = [dieRoll];
  const effect = level ? dieRoll.total : null;
  let cost = castCost(system, level, dieRoll.total);
  let scarRoll = null;
  if (inScar) {
    const d6 = await rollSum('1d6');
    scarRoll = d6.total;
    const extra = scarRoll === 6 ? await rollSum('2d6+6') : null;
    rolls.push(d6, extra);
    cost = scarCost(cost, scarRoll, extra?.total);
  }

  const loss = await applyStabilityLoss(actor, cost);
  const hpAmount = level ? system.hpCost?.[level] : 0;
  const hpCost = hpAmount ? await applyHpCost(actor, hpAmount) : null;
  if (level === 'unbound') await addFatigue(actor);

  const data = {
    name: manifestation.name,
    categoryLabel: categoryLabel(manifestation),
    intensity: level,
    intensityLabel: intensityLabel(level),
    die,
    effect,
    effectText: level ? fillDice(system.effectText?.[level], effect) : '',
    costFormula: costLabel(system, level),
    cost,
    viaTome,
    requiresTrueName: system.requiresTrueName,
    calm: !pressured,
    contained: level === 'contained',
    inScar,
    scarRoll,
    helpers,
    helperCost: helperActors.length ? halve(cost) : 0,
    stability: stabilityLine(loss),
    attunementDelta: loss?.attunementDelta ? `+${loss.attunementDelta}` : '',
    attunement: loss?.next.attunement,
    hpChanges: hpCost?.changes,
    strSave: hpCost?.strSave,
    fatigue: level === 'unbound',
    targets,
    outcome: 'happens',
    extraAction: level ? itemFlags(manifestation).cardActions?.[level] ?? '' : '',
  };

  const calmAllowed = settings.get('hda-calm-no-test') && system.calmNoTest;
  let cursed = false;
  if (level !== 'contained' && (pressured || !calmAllowed)) {
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

  const message = await postCard('cast', data, {
    actor,
    rolls,
    before,
    extra: { item: manifestation.uuid },
  });
  await postBreakCard(actor, loss);
  for (const helper of helperActors) await payOn(helper, halve(cost), t('HDA.HelperPays', { name: manifestation.name }));
  if (cursed) await rollCurse(actor, { cost, source: manifestation.name });
  if (data.outcome === 'happens') await applyEffect(actor, manifestation, { intensity: level, effect, targets });
  return message;
}

/* ---- Diálogo ----------------------------------------------------------- */

/** Mantém o topo, a escolha de intensidade e a linha de resumo em dia. */
function wireCastDialog(root) {
  const form = root.querySelector('form') ?? root.closest('form');
  const body = root.querySelector('.hda-cast');
  const update = () => {
    const option = form.elements.manifestation.selectedOptions[0];
    const { dataset } = option;
    root.querySelector('.hda-ttl').textContent = dataset.name;
    root.querySelector('.hda-tag').textContent = dataset.category;
    const trueName = root.querySelector('.hda-true-name');
    trueName.hidden = dataset.trueName !== 'true';

    const violent = dataset.violent === 'true';
    const levels = root.querySelector('.hda-intensity');
    levels.hidden = violent;
    for (const level of ['contained', 'full', 'unbound']) {
      levels.querySelector(`[data-level="${level}"]`).textContent = dataset[level];
    }
    const intensity = violent ? null : form.elements.intensity.value;
    const contained = intensity === 'contained';
    form.elements.calm.disabled = contained;

    const payers = form.querySelectorAll('input[name="helper"]:checked').length;
    const helpers = Math.max(0, form.elements.extraHelpers.valueAsNumber || 0) + payers;
    const bonus = helpers + (!trueName.hidden && form.elements.trueName.checked ? 2 : 0);
    const noTest = contained || (form.elements.calm.checked && settings.get('hda-calm-no-test'));
    const test = noTest ? t(contained ? 'HDA.ContainedNoTest' : 'HDA.CalmNoTest')
      : `${t('HDA.WilTest')} ${body.dataset.wil}${bonus ? ` +${bonus}` : ''}.`;
    let cost;
    if (violent) cost = t('HDA.CostIs', { cost: dataset.violentCost });
    else if (contained) cost = t('HDA.CostContained', { die: dataset.containedDie });
    else {
      const die = dataset[`${intensity}Die`];
      const extra = Number(dataset.bonus) ? ` + ${dataset.bonus}` : '';
      cost = t(intensity === 'unbound' ? 'HDA.CostUnbound' : 'HDA.CostFull', { die, extra });
    }
    const help = payers ? ` ${t('HDA.HelpersPayHalf')}` : '';
    root.querySelector('.hda-sum').textContent = `${test} ${cost}${help}`;
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
  const label = (row, level) => `${intensityLabel(level)} ${row.dice?.[level] ?? ''}`;
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/dialog/cast.hbs`, {
    rows: rows.map((row) => ({
      ...row,
      selected: row.uuid === selected.uuid,
      containedLabel: label(row, 'contained'),
      fullLabel: label(row, 'full'),
      unboundLabel: label(row, 'unbound'),
      violentCost: costLabel({ category: 'violent', costBonus: row.costBonus }, null),
    })),
    single: rows.length === 1,
    inScar: scarByDefault(),
    helpers: helpers.map((a) => ({ uuid: a.uuid, name: a.name })),
    targets: [...game.user.targets].map((token) => token.name).join(', '),
    wil: actor.system.abilities.WIL.value,
  });

  const data = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title: t('HDA.Cast') },
    position: { width: 440 },
    content,
    render: (_event, dialog) => wireCastDialog(dialog.element),
    ok: {
      label: t('HDA.Cast'),
      callback: (_event, button) => {
        const form = button.form.elements;
        const payers = [...button.form.querySelectorAll('input[name="helper"]:checked')].map((el) => el.value);
        return {
          uuid: form.manifestation.value,
          intensity: form.intensity.value,
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
    intensity: data.intensity,
    underPressure: data.underPressure,
    inScar: data.inScar,
    trueName: data.trueName,
    viaTome: row.viaTome,
    helpers: data.helpers,
    helperActors: await Promise.all(data.payers.map((helper) => fromUuid(helper))),
  });
}

/* ---- Ruptura ----------------------------------------------------------- */

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

/* ---- Ações do cartão --------------------------------------------------- */

/** Personagens do usuário que podem Anular aquele cartão. */
function annulCandidates(message) {
  const flags = cardFlags(message);
  return game.actors.filter((a) => a.type === 'character' && a.isOwner && a.uuid !== flags.actor
    && a.system.mind.awakened && knowsByName(a, flags.data.name));
}

async function chooseActor(candidates, title) {
  if (candidates.length === 1) return candidates[0];
  const options = candidates.map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`).join('');
  const id = await DialogV2.prompt({
    classes: ['hda-dialog'],
    window: { title },
    content: `<select name="actor">${options}</select>`,
    ok: { label: title, callback: (_event, button) => button.form.elements.actor.value },
    rejectClose: false,
  });
  return id ? game.actors.get(id) : null;
}

async function castContext(message) {
  const flags = cardFlags(message);
  const actor = await fromUuid(flags.actor);
  const item = await fromUuid(flags.item);
  return { flags, data: flags.data, actor, item };
}

registerCardAction('force', {
  run: async (message) => {
    const { data, actor, item } = await castContext(message);
    if (data.outcome !== 'failed') return;
    const before = snapshot(actor);
    const loss = await applyStabilityLoss(actor, data.forceCost, { countsForAttunement: false });
    if (!loss) return;
    await updateCard(message, { outcome: 'forced' });
    await postLossCards(actor, loss, { source: t('HDA.Force'), before });
    if (item) await applyEffect(actor, item, { intensity: data.intensity, effect: data.effect, targets: data.targets ?? [] });
  },
});

/** Deixar escapar: acontece, com uma complicação do d6 (A.4a). */
registerCardAction('letSlip', {
  run: async (message) => {
    const { data, actor, item } = await castContext(message);
    if (data.outcome !== 'failed') return;
    const roll = await rollSum('1d6');
    const complication = complicationFor(roll.total);
    const halved = complication === 'half' && data.effect !== null ? halve(data.effect) : data.effect;
    // Alvo errado e Rebote: o Guardião escolhe o alvo no cartão.
    const gmPicks = complication === 'wrongTarget' || complication === 'rebound';
    await updateCard(message, {
      outcome: 'slipped',
      complication,
      complicationRoll: roll.total,
      effect: halved,
      effectText: data.intensity && item ? fillDice(item.system.effectText?.[data.intensity], halved) : data.effectText,
      pendingTarget: gmPicks && data.effect !== null,
    });
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
    if (!gmPicks && item) await applyEffect(actor, item, { intensity: data.intensity, effect: halved, targets: data.targets ?? [] });
  },
});

/** Alvo errado e Rebote: o Guardião marca o alvo e aplica (Rebote: metade do efeito). */
registerCardAction('applyToTarget', {
  visible: (message) => game.user.isGM && Boolean(cardFlags(message).data.pendingTarget),
  run: async (message) => {
    const { data, actor, item } = await castContext(message);
    const targets = [...game.user.targets].map((token) => token.id);
    if (!targets.length) {
      ui.notifications.warn(t('HDA.Notify.TargetFirst'));
      return;
    }
    const effect = data.complication === 'rebound' ? halve(data.effect) : data.effect;
    await updateCard(message, { pendingTarget: false });
    if (item) await applyEffect(actor, item, { intensity: data.intensity, effect, targets });
  },
});

/** Apagar o Fogo, Plena: 1 Fadiga em cada ator selecionado. */
registerCardAction('fatigueSelected', {
  visible: (message) => ownsCard(message) || game.user.isGM,
  run: async () => {
    const actors = canvas.tokens?.controlled.map((token) => token.actor).filter(Boolean) ?? [];
    if (!actors.length) {
      ui.notifications.warn(t('HDA.Notify.SelectTokens'));
      return;
    }
    for (const actor of actors) await addFatigue(actor);
    ui.notifications.info(t('HDA.Notify.FatigueAdded', { names: actors.map((a) => a.name).join(', ') }));
  },
});

/** Apagar o Fogo, Desmedida: Estabilidade 1d3 para quem viu. */
registerCardAction('stabilitySelected', {
  visible: (message) => ownsCard(message) || game.user.isGM,
  run: async (message) => {
    const actors = (canvas.tokens?.controlled.map((token) => token.actor) ?? []).filter((a) => a?.type === 'character');
    if (!actors.length) {
      ui.notifications.warn(t('HDA.Notify.SelectCharacter'));
      return;
    }
    for (const actor of actors) await loseOn(actor, { formula: '1d3', source: cardFlags(message).data.name });
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

registerCardAction('annul', {
  visible: (message) => !cardFlags(message).data.annulled && annulCandidates(message).length > 0,
  run: async (message) => {
    const annuller = await chooseActor(annulCandidates(message), t('HDA.Annul'));
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
