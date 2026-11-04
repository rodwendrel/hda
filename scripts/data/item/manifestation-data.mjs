import { fields } from '@vttforge/core';
import { manifestationCost } from '../../hda/rules.mjs';
import { itemDataModel } from './base-item-data.mjs';
import { universalFields } from './templates.mjs';

/** HDA: uma Manifestação da Ressonância (seção 4.3). */
function defineManifestationSchema() {
  const f = fields();
  const text = () => new f.StringField({ required: true, blank: true, initial: '' });
  const flag = (initial) => new f.BooleanField({ required: true, nullable: false, initial });
  return {
    ...universalFields(f),
    category: new f.StringField({ required: true, choices: ['subtle', 'manifest', 'violent'], initial: 'subtle' }),
    costBonus: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 3, initial: 0 }),
    domain: new f.StringField({ required: true, choices: ['common', 'visceral'], initial: 'common' }),
    hpCost: text(),
    effectFormula: text(),
    effectType: new f.StringField({ required: true, choices: ['none', 'damage', 'heal', 'stabilityLoss'], initial: 'none' }),
    /** A perda de quem é curado (Remendo), além do efeito. */
    healStabilityLoss: text(),
    ignoresArmor: flag(false),
    requiresTrueName: flag(false),
    calmNoTest: flag(true),
  };
}

export class ManifestationData extends itemDataModel(defineManifestationSchema) {
  prepareDerivedData() {
    super.prepareDerivedData();
    this.weightless = true;
    // `cost` já é o preço do item (`universalFields`); o custo em Estabilidade é outro.
    this.costFormula = manifestationCost(this.category, this.costBonus);
  }
}
