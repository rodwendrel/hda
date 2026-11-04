/**
 * Migração do módulo MVP. `migrateMvpFlags` (rules.mjs) só muda a memória, e o
 * servidor não conhece o schema de `system`: sem gravar `mind` inteiro, o
 * primeiro update parcial deixaria a flag sobrescrever o valor na carga
 * seguinte. Por isso o Guardião grava uma vez e marca `mvpMigrated`.
 */
import { SYSTEM_ID } from '../settings.mjs';

async function persist(actor) {
  if (actor.type !== 'character' || !actor.flags['herdeiros-do-abismo']?.mente) return;
  if (actor.getFlag(SYSTEM_ID, 'mvpMigrated')) return;
  await actor.update(
    { 'system.mind': actor.toObject().system.mind, [`flags.${SYSTEM_ID}.mvpMigrated`]: true },
    { diff: false },
  );
}

export async function persistMvpMigrations() {
  if (!game.users.activeGM?.isSelf) return;
  for (const actor of game.actors) await persist(actor);
}

export function watchMvpImports() {
  Hooks.on('createActor', (actor) => {
    if (game.users.activeGM?.isSelf) persist(actor);
  });
}
