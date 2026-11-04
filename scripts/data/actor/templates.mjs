/**
 * What the old template.json shared between Actor types, as functions of
 * the fields bag. A type spreads the ones it needs.
 */

/** Hit protection and the three abilities, each a current value and a max. */
export function actorBaseFields(f) {
  const stat = (initial) =>
    new f.SchemaField({
      value: new f.NumberField({ required: true, nullable: false, integer: true, initial }),
      max: new f.NumberField({ required: true, nullable: false, integer: true, initial }),
    });
  return {
    hp: stat(6),
    abilities: new f.SchemaField({ STR: stat(10), DEX: stat(10), WIL: stat(10) }),
  };
}

/** HDA: a mente (seção 4.1). Os derivados ficam em `CharacterData.prepareDerivedData`. */
export function mindFields(f) {
  const count = (options = {}) =>
    new f.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, ...options });
  const flag = () => new f.BooleanField({ required: true, nullable: false, initial: false });
  return new f.SchemaField({
    stability: new f.SchemaField({ value: count(), max: count() }),
    attunement: count(),
    insanity: count({ max: 3 }),
    awakened: flag(),
    resonating: flag(),
    marks: new f.HTMLField({ required: true, blank: true, initial: '' }),
    lost: flag(),
  });
}

/** A feature: a named trait and the things it says it modifies. */
export function featureField(f) {
  const flag = () => new f.BooleanField({ required: true, nullable: false, initial: false });
  return new f.SchemaField({
    id: new f.StringField({ required: true, blank: true, initial: '' }),
    name: new f.StringField({ required: true, blank: true, initial: '' }),
    description: new f.StringField({ required: true, blank: true, initial: '' }),
    str: flag(),
    dex: flag(),
    wil: flag(),
    hp: flag(),
    armor: flag(),
    dmg: flag(),
    crit: flag(),
    deprived: flag(),
    blast: flag(),
  });
}

/** `{ value }`, for the slot and cost counters the sheets edit as `system.x.value`. */
export function valueField(f, initial = 0) {
  return new f.SchemaField({
    value: new f.NumberField({ required: true, nullable: false, integer: true, initial }),
  });
}

/**
 * The old template declared `slots` and `cost` as plain numbers while the
 * sheets wrote `slots.value` and `cost.value`. A stored number becomes the
 * object the schema declares, once, on load.
 */
export function liftNumberToValue(source, key) {
  if (typeof source[key] === 'number') source[key] = { value: source[key] };
  return source;
}
