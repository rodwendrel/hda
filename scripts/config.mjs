/** @name CONFIG.Cairn */
export const Cairn = {};

Cairn.characterGenerator = {
  ability: "3d6",
  hitProtection: "1d6",
  gold: "3d6",
  name: {
    text: "{name} {surname}",
    items: {
      name: "herdeiros.character-creation-tables-srd;Names",
      surname: "herdeiros.character-traits;Surnames"
    }
  },
  // HDA: gerador do cenário (seção 6.6). Antecedente e Origem trazem texto e itens.
  background: "herdeiros.hda-backgrounds;Antecedentes",
  origin: "herdeiros.hda-tables;Origens",
  stability: "@WIL + 1d6 + 6",
  awakeningDie: "1d6",
  startingItems: [
    "herdeiros.expeditionary-gear;Rations;1;Rações",
    "herdeiros.expeditionary-gear;Torch;1;Tocha"
  ]
};

/** HDA: a tabela de Exposição (A.3), atalhos do diálogo de perda. */
Cairn.exposures = [
  { label: "HDA.Exposure.brutal", formula: "1" },
  { label: "HDA.Exposure.glimpse", formula: "1d3" },
  { label: "HDA.Exposure.minor", formula: "1d6" },
  { label: "HDA.Exposure.truth", formula: "2d6" },
  { label: "HDA.Exposure.powerful", formula: "2d6+6" }
];
