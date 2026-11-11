/**
 * Cartões de chat do sistema. Todo cartão sai de `templates/chat/` e guarda em
 * `flags.herdeiros` o tipo e os dados, para poder ser redesenhado quando muda
 * de estado (Forçar, Anular, Desfazer).
 */
import { SYSTEM_ID } from '../settings.mjs';
import { onRelay, relay } from './socket.mjs';

const { renderTemplate } = foundry.applications.handlebars;

export const renderCard = (type, data) => renderTemplate(`systems/${SYSTEM_ID}/templates/chat/${type}.hbs`, data);

export const cardFlags = (message) => message.flags?.[SYSTEM_ID];

/**
 * O texto de um trecho HTML, sem as tags. O `DOMParser` não executa scripts nem
 * atributos de evento, e não deixa sobrar tag partida como um regex deixaria.
 */
export function htmlToText(html) {
  return new DOMParser().parseFromString(String(html ?? ''), 'text/html').body.textContent ?? '';
}

function speakerOf({ actor, token }) {
  return ChatMessage.getSpeaker(token ? { token } : { actor });
}

function buildFlags(type, data, { actor, before, extra }) {
  return { [SYSTEM_ID]: { card: type, data, actor: actor?.uuid, before, ...extra } };
}

/** Cartão comum. As rolagens vão em `rolls`, para o Dice So Nice e o tooltip. */
export async function postCard(type, data, { actor, token, rolls = [], before, extra, whisper } = {}) {
  const valid = rolls.filter(Boolean);
  return ChatMessage.create({
    speaker: speakerOf({ actor, token }),
    content: await renderCard(type, data),
    rolls: valid,
    whisper,
    sound: valid.length ? CONFIG.sounds.dice : undefined,
    flags: buildFlags(type, data, { actor, before, extra }),
  });
}

/** Cartão de uma rolagem só: respeita o modo de rolagem de quem clicou. */
export async function postRoll(roll, type, data, { actor, token, extra } = {}) {
  return roll.toMessage({
    speaker: speakerOf({ actor, token }),
    content: await renderCard(type, data),
    flags: buildFlags(type, data, { actor, extra }),
  });
}

/** Aviso curto: título, etiqueta, linhas e mudanças. */
export const postNotice = (data, options) => postCard('notice', data, options);

async function writeCard(message, patch, flagPatch = {}) {
  const flags = cardFlags(message);
  const data = { ...flags.data, ...patch };
  return message.update({
    content: await renderCard(flags.card, data),
    flags: { [SYSTEM_ID]: { ...flagPatch, data } },
  });
}

/** Redesenha um cartão, pelo Guardião se a mensagem não for de quem clicou. */
export function updateCard(message, patch, flagPatch) {
  return relay('updateCard', { id: message.id, patch, flagPatch }, message.canUserModify(game.user, 'update'));
}

onRelay('updateCard', ({ id, patch, flagPatch }) => {
  const message = game.messages.get(id);
  return message ? writeCard(message, patch, flagPatch) : null;
});

/** Só o dono do personagem ou o Guardião agem por ele. */
export function ownsCard(message) {
  if (game.user.isGM) return true;
  const uuid = cardFlags(message)?.actor;
  const actor = uuid ? fromUuidSync(uuid) : null;
  return Boolean(actor?.isOwner);
}

/** A mensagem mais nova com perda desfazível daquele personagem. */
export function lastUndoable(actorUuid) {
  const messages = game.messages.contents;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const flags = cardFlags(messages[i]);
    if (flags?.before?.actor === actorUuid && !flags.undone) return messages[i];
  }
  return null;
}

/** Cada `data-hda-action`: quem vê o botão e o que ele faz. Preenchido pelos módulos. */
const actions = new Map();

export function registerCardAction(name, { visible = ownsCard, run }) {
  actions.set(name, { visible, run });
}

/** Hook `renderChatMessageHTML`: classes da mensagem e botões dos cartões. */
export function bindCard(message, html) {
  // O v14 não marca mais as mensagens fora do jogo; o tema de mesa precisa disso.
  if (message.style === CONST.CHAT_MESSAGE_STYLES.OOC) html.classList.add('ooc');
  const flags = cardFlags(message);
  if (!flags?.card) return;
  html.classList.add('hda-msg');
  if (flags.card === 'curse') html.classList.add('hda-curse');
  for (const button of html.querySelectorAll('[data-hda-action]')) {
    const action = actions.get(button.dataset.hdaAction);
    if (!action?.visible(message, button)) {
      button.style.display = 'none';
      continue;
    }
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await action.run(message, button);
      } finally {
        button.disabled = false;
      }
    });
  }
}
