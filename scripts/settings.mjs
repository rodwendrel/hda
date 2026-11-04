import { SystemConfig } from '@vttforge/core';

export const SYSTEM_ID = 'herdeiros'; // HDA: id do fork

/** One wrapper for every read of a Cairn setting: `settings.get('use-panic')`. */
export const settings = new SystemConfig(SYSTEM_ID);

const WORLD_SETTINGS = [
  ['max-equip-slots', 'MaxEquipSlots', Number, 10],
  ['use-gold-threshold', 'UseGoldThreshold', Number, 0],
  ['show-gold-not-cost', 'ShowGoldNotCost', Boolean, false],
  ['use-panic', 'UsePanic', Boolean, false],
  ['use-item-icons', 'UseItemIcons', Boolean, true],
  ['use-cairn-dice-notation', 'UseCairnDiceNotation', Boolean, true],
  ['show-generate-header', 'ShowGenerateHeader', Boolean, false],
  ['show-features-section', 'ShowFeatures', Boolean, false],
  ['show-container-actors', 'ShowContainerActors', Boolean, false],
  ['character-inventory-limit', 'CharacterInventoryLimit', Boolean, false],
];

// HDA: configurações do cenário (seção 7), rótulos em HDA.Settings.*.
const HDA_WORLD_SETTINGS = [
  ['hda-curse-on-nat20', 'CurseOnNat20', Boolean, true],
  ['hda-calm-no-test', 'CalmNoTest', Boolean, true],
  ['hda-will-damage-armor', 'WillDamageArmor', Boolean, false],
  ['hda-optional-advancement', 'OptionalAdvancement', Boolean, false],
  ['hda-cold-rule', 'ColdRule', Boolean, true],
  ['hda-use-name-table', 'UseNameTable', Boolean, false],
];

/** HDA: `table` estende o tema Sombria à interface inteira, sem recarregar. */
export function applyUiTheme(value = settings.get('hda-ui-theme')) {
  document.body.classList.toggle('hda-ui', value === 'table');
}

/** Runs inside `init`, where `game.settings` accepts registrations. */
export function registerSettings() {
  for (const [key, label, type, initial] of WORLD_SETTINGS) {
    settings.register(key, {
      name: `CAIRN.Settings.${label}.label`,
      hint: `CAIRN.Settings.${label}.hint`,
      scope: 'world',
      config: true,
      type,
      default: initial,
      requiresReload: true,
    });
  }
  // HDA
  for (const [key, label, type, initial] of HDA_WORLD_SETTINGS) {
    settings.register(key, {
      name: `HDA.Settings.${label}.label`,
      hint: `HDA.Settings.${label}.hint`,
      scope: 'world',
      config: true,
      type,
      default: initial,
    });
  }
  settings.register('hda-ui-theme', {
    name: 'HDA.Settings.UiTheme.label',
    hint: 'HDA.Settings.UiTheme.hint',
    scope: 'client',
    config: true,
    type: String,
    choices: { cards: 'HDA.Settings.UiTheme.cards', table: 'HDA.Settings.UiTheme.table' },
    default: 'cards',
    onChange: applyUiTheme,
  });
}
