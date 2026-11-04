import { fields } from '@vttforge/core';
import { itemDataModel } from './base-item-data.mjs';
import { universalFields } from './templates.mjs';

function defineSpellbookSchema() {
  const f = fields();
  return {
    ...universalFields(f),
    manifestationUuid: new f.StringField({ required: true, blank: true, initial: '' }), // HDA: o Tomo contém uma Manifestação
  };
}

export class SpellbookData extends itemDataModel(defineSpellbookSchema) {}
