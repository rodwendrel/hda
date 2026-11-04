/** Maldições (d66). O texto vem da RollTable; a automação, da faixa do resultado. */
import { findCompendiumItem } from '../compendium.mjs';
import { SYSTEM_ID } from '../settings.mjs';
import { cardFlags, ownsCard, postCard, postNotice, registerCardAction, updateCard } from './chat.mjs';
import { loseStability, payOn, rollSum } from './mind.mjs';
import { CURSE_AUTOMATION } from './rules.mjs';

const { DialogV2 } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export async function appendMark(actor, text) {
  await actor.update({ 'system.mind.marks': `${actor.system.mind.marks ?? ''}<p>${text}</p>` });
}

async function feverDamage(actor) {
  const roll = await rollSum('1d6');
  const { value } = actor.system.hp;
  const to = Math.max(0, value - roll.total);
  await actor.update({ 'system.hp.value': to });
  await postNotice({
    title: t('HDA.Curse'),
    changes: [{ label: t('CAIRN.HitProtection'), from: value, to }],
  }, { actor, rolls: [roll] });
}

/** `cost` é o que o conjurador pagou, para "O preço do outro". */
export async function rollCurse(actor, { cost = 0, source = '' } = {}) {
  const table = await findCompendiumItem(`${SYSTEM_ID}.hda-tables`, 'Maldições');
  if (!table) {
    ui.notifications.error(t('HDA.Notify.NoCurseTable'));
    return null;
  }
  const { roll, results } = await table.roll();
  const result = results[0];
  const automation = CURSE_AUTOMATION[result.range[0]];
  const text = result.description;
  const data = {
    roll: roll.total,
    text,
    source,
    otherPrice: automation === 'otherPrice' && cost > 0,
    cost,
    canRecord: automation !== 'mark' && automation !== 'whisper',
  };

  if (automation === 'whisper') {
    const whisper = ChatMessage.getWhisperRecipients('GM').map((user) => user.id);
    await postCard('curse', data, { actor, rolls: [roll], whisper });
    await postCard('curse', { roll: roll.total, text: t('HDA.CurseHidden') }, { actor });
    return result;
  }
  await postCard('curse', data, { actor, rolls: [roll] });
  if (automation === 'crack') await loseStability(actor, { formula: '2d6', source: result.name });
  if (automation === 'fever') await feverDamage(actor);
  if (automation === 'mark') await appendMark(actor, text);
  return result;
}

/** O aliado: o alvo marcado por quem clicou, ou o personagem mais perto do conjurador. */
function nearestAlly(actor) {
  const targeted = game.user.targets.first()?.actor;
  if (targeted) return targeted;
  const origin = actor.getActiveTokens()[0];
  if (!origin) return null;
  const others = canvas.tokens.placeables.filter((token) => token.actor?.type === 'character' && token.actor !== actor);
  const distance = (token) => Math.hypot(token.x - origin.x, token.y - origin.y);
  return others.sort((a, b) => distance(a) - distance(b))[0]?.actor ?? null;
}

registerCardAction('otherPrice', {
  visible: (message) => ownsCard(message) && !cardFlags(message).data.paid,
  run: async (message) => {
    const flags = cardFlags(message);
    const ally = nearestAlly(await fromUuid(flags.actor));
    if (!ally) {
      ui.notifications.warn(t('HDA.Notify.NoAlly'));
      return;
    }
    await payOn(ally, flags.data.cost, t('HDA.OtherPrice'));
    await updateCard(message, { paid: true, otherPrice: false });
  },
});

registerCardAction('recordMark', {
  run: async (message) => {
    const flags = cardFlags(message);
    const actor = await fromUuid(flags.actor);
    const preset = flags.card === 'curse' ? flags.data.text.replace(/<[^>]+>/g, '') : '';
    const text = await DialogV2.prompt({
      classes: ['hda-dialog'],
      window: { title: t('HDA.RecordInMarks') },
      content: `<textarea name="mark" rows="3">${foundry.utils.escapeHTML(preset)}</textarea>`,
      ok: { label: t('HDA.RecordInMarks'), callback: (_event, button) => button.form.elements.mark.value.trim() },
      rejectClose: false,
    });
    if (text) await appendMark(actor, foundry.utils.escapeHTML(text));
  },
});
