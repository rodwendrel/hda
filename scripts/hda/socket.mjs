/**
 * Jogadores não podem mexer no ator nem na mensagem de outro jogador, e várias
 * regras exigem isso: ajudantes pagam metade, Anular marca o cartão alheio,
 * "O preço do outro" cobra do aliado. O que o usuário não pode fazer vai para
 * o Guardião ativo pelo socket do sistema.
 */
import { SYSTEM_ID } from '../settings.mjs';

const CHANNEL = `system.${SYSTEM_ID}`;
const handlers = new Map();

export function onRelay(op, handler) {
  handlers.set(op, handler);
}

/** Roda aqui se `allowed`; senão pede ao Guardião. */
export async function relay(op, payload, allowed = game.user.isGM) {
  if (allowed) return handlers.get(op)(payload);
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize('HDA.Notify.NeedsGM'));
    return null;
  }
  game.socket.emit(CHANNEL, { op, payload });
  return null;
}

export function listenRelay() {
  game.socket.on(CHANNEL, ({ op, payload }) => {
    if (game.users.activeGM?.isSelf) handlers.get(op)?.(payload);
  });
}
