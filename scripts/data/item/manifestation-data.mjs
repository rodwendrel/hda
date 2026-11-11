import { fields } from '@vttforge/core';
import { costLabel, INTENSITIES, migrateManifestation } from '../../hda/rules.mjs';
import { itemDataModel } from './base-item-data.mjs';
import { universalFields } from './templates.mjs';

/**
 * HDA: uma Manifestação da Ressonância (seção 4.3). Sutis e Manifestas têm três
 * intensidades, cada uma com um dado: o mesmo resultado é o efeito e o custo.
 */
function defineManifestationSchema() {
  const f = fields();
  const flag = (initial) => new f.BooleanField({ required: true, nullable: false, initial });
  const die = (initial) => new f.StringField({ required: true, blank: false, initial });
  const pg = () => new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 });
  const html = () => new f.HTMLField({ required: true, blank: true, initial: '' });
  return {
    ...universalFields(f),
    category: new f.StringField({ required: true, choices: ['subtle', 'manifest', 'violent'], initial: 'subtle' }),
    costBonus: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 3, initial: 0 }),
    domain: new f.StringField({ required: true, choices: ['common', 'visceral'], initial: 'common' }),
    dice: new f.SchemaField({ contained: die('d4'), full: die('d6'), unbound: die('d8') }),
    /** Sangria: PG que quem conjura perde, por intensidade. */
    hpCost: new f.SchemaField({ contained: pg(), full: pg(), unbound: pg() }),
    effectType: new f.StringField({
      required: true,
      choices: ['none', 'damage', 'dexDamage', 'wilDamage', 'heal', 'stabilityLoss'],
      initial: 'none',
    }),
    /** O texto de cada intensidade; `[dado]` vira o resultado no cartão. */
    effectText: new f.SchemaField({ contained: html(), full: html(), unbound: html() }),
    ignoresArmor: flag(false),
    requiresTrueName: flag(false),
    calmNoTest: flag(true),
  };
}

export class ManifestationData extends itemDataModel(defineManifestationSchema) {
  /** Itens do formato antigo (uma fórmula de efeito e um custo em texto). */
  static migrateData(source) {
    migrateManifestation(source);
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.weightless = true;
    this.violent = this.category === 'violent';
    // `cost` já é o preço do item (`universalFields`); o custo em Estabilidade é outro.
    this.costLabels = Object.fromEntries(INTENSITIES.map((i) => [i, costLabel(this, i)]));
    this.costFormula = this.violent ? costLabel(this, null) : INTENSITIES.map((i) => this.costLabels[i]).join(' · ');
  }
}
