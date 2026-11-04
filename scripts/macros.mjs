import { settings, SYSTEM_ID } from './settings.mjs';
import { Damage } from './damage.mjs';
import { evaluateFormula, getInfoFromDropData } from './utils.mjs';

/**
 * @param {Object} data
 * @param {Number} slot
 * @return {Promise.<void>}
 */
export const createCairnMacro = async (data, slot) => {
  const { item, actor } = await getInfoFromDropData(data);

  if (data.type !== "Item") {
    if (item !== undefined) {
      const macro = await Macro.create({
        name: item.name,
        type: "script",
        img: item.img,
        command: 'await foundry.applications.ui.Hotbar.toggleDocumentSheet("' + item.uuid + '")',
        flags: { [`${SYSTEM_ID}.itemMacro`]: true },
      });
      await game.user.assignHotbarMacro(macro, slot);
    }

    return true;
  }

  if (!actor) {
    return ui.notifications.warn("You can only create macro buttons for owned Items");
  }

  if (item.type !== "weapon") {
    return ui.notifications.warn("Macros only supported for weapons");
  }

  const command = `game.cairn.rollItemMacro("${actor.id}", "${item.id}");`;
  let macro = game.macros.find((m) => m.name === item.name && m.command === command);
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      flags: { [`${SYSTEM_ID}.itemMacro`]: true },
    });
  }
  await game.user.assignHotbarMacro(macro, slot);
  return false;
};

/**
 * @param {string} actorId
 * @param {string} itemId
 * @return {Promise.<void>}
 */
export const rollItemMacro = async (actorId, itemId) => {
  const actor = game.actors.get(actorId);
  const item = actor.items.get(itemId);

  if (!item || !actor) {
    return ui.notifications.warn(`Actor "${actor.name}" does not have an item named ${item.name}`);
  }

  let rollSchema = item.system.damageFormula;
  // determine panic
  const usePanic = settings.get('use-panic');
  let panicLabel = "";
  if (usePanic && actor.system.panicked) {
    rollSchema = "1d4"; // panicked character
    panicLabel = "(" + game.i18n.localize("CAIRN.RollingWithPanic") + ")";
  }
  // determine roll result   
  const roll = await evaluateFormula(rollSchema, actor.getRollData());
  const label = item.name
    ? game.i18n.localize("CAIRN.RollingDmgWith") +
    ` ${item.name} ` +
    panicLabel
    : "";

  // HDA: o cartão de dano é o mesmo da ficha.
  await Damage.postRoll(actor, roll, { label });
};
