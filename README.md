# Herdeiros do Abismo (Cairn) para Foundry VTT

Sistema para Foundry VTT 14 com as **Regras B** de *Herdeiros do Abismo*: fantasia sombria sobre o Cairn 1e. O Sol morreu, o mundo é frio, e a Ressonância é um poder mental que custa sanidade.

É um fork do sistema [Cairn](https://github.com/yochaigal/Cairn-FoundryVTT). Tudo o que o Cairn faz continua aqui; o fork acrescenta:

- **a mente:** Estabilidade, Sintonia, Insanidade, transbordo para a VON, Delirante e Perdido;
- **a Ressonância:** Manifestações pagas em Estabilidade, com calma ou sob pressão, Forçar, Maldições, Cicatriz, ajudantes, Anular, Ressoar, Ruptura e Tomos;
- **dano de VON** e dano que ignora Armadura;
- **conteúdo:** 17 Manifestações, Maldições (d66), Exposição, Surtos finais, Antecedentes, Origens, criaturas e 8 personagens prontos;
- **gerador de personagem** do cenário;
- **tema visual Sombria** em fichas, diálogos e cartões de chat.

## Instalação

No Foundry, em *Game Systems → Install System*, cole a URL do manifesto:

```
https://github.com/rodwendrel/hda/releases/latest/download/system.json
```

Crie um mundo com o sistema e permita que os jogadores criem atores em *Configure Settings → Permissions*.

## Para o Guardião

| No jogo | Como |
| --- | --- |
| Perda de Estabilidade em vários tokens | selecione os tokens e rode `game.herdeiros.horror()` |
| Fim da cena (ninguém mais ressoa) | `game.herdeiros.endScene()` |
| A cena está na Cicatriz | `game.herdeiros.toggleScar()` |
| Ruptura, Despertar | aba Ressonância da ficha, só para o Guardião |
| Dano de VON de um PNJ | preencha **Ataque à VON** no topo da aba Itens do PNJ |
| Perda ao ver um PNJ | preencha **Ao ser visto**, marque os alvos e clique no rótulo |
| Desfazer uma perda | botão no cartão, só na última perda do personagem |

Ações sobre o personagem de outro jogador (ajudantes, Anular, "O preço do outro") passam pelo Guardião: é preciso haver um conectado.

### Configurações

Em *Configure Settings → System Settings*: Maldição no 20 natural, com calma sem teste, Armadura contra dano de VON, evolução opcional, regra do frio, tabela de nomes própria e tema da interface. O tema **Mesa inteira** estende o Sombria ao chat, à barra lateral e às notificações; use-o com o tema escuro do núcleo.

### Tabela de nomes

Sem configuração, o gerador usa as tabelas de nomes do Cairn. Para usar a sua, crie uma tabela do mundo chamada **Nomes de Herdeiros** e ligue *Usar tabela de nomes própria*. A tabela de nomes galego-portugueses não vem no sistema até a licença dela ser confirmada.

## Migração

### Do módulo `herdeiros-do-abismo`

Exporte os personagens do mundo Cairn como JSON e importe no mundo novo. Os dados guardados nas flags do módulo são copiados para a ficha na primeira carga, feita pelo Guardião. A flag fica no ator, para poder reverter.

### De um mundo Cairn

O id do sistema mudou, então mundos Cairn **não abrem** neste sistema. Exporte atores e itens como JSON ou para um compêndio, crie o mundo novo e importe. Depois, `game.herdeiros.convertSpellbooks()` troca os nomes genéricos de Livro de Feitiço por Tomo; o tipo do item não muda.

## Desenvolvimento

Node 24 ou mais recente.

```bash
npm install
npm test
npm run build
```

`dist/` é o sistema pronto; copie para `Data/systems/herdeiros`.

- **Regras:** `scripts/hda/rules.mjs` são funções puras, cobertas por `npm test`. O resto de `scripts/hda/` liga as regras ao Foundry.
- **Compêndios:** edite `src/packs/<pack>/*.json`; o `npm run build` compila para `packs/`.
- **Upstream:** a branch `upstream` acompanha o original e `main` tem as mudanças. Toda alteração em arquivo do upstream leva `HDA:` num comentário. Depois de um merge que traga packs novos, rode `npm run packs:rebrand`.
- **Rolagens:** a notação do Cairn lê `d6+d6` como o maior dos dois. Custos e Estabilidade somam de verdade, com `evaluateFormula(f, data, { sum: true })`.

## Créditos e licenças

- **Código:** MIT. Sistema Cairn de Yochai Gal e Oskar Świda, com contribuições da comunidade; ver `LICENSE.txt`.
- **Regras do Cairn:** CC-BY-SA 4.0, Yochai Gal; versão brasileira de Rafa Arruda.
- **Regras de Herdeiros do Abismo (B):** CC-BY-SA 4.0.
- **Fontes:** IM Fell English e IM Fell English SC (Igino Marini), Source Sans 3 (Adobe), sob a SIL Open Font License 1.1; ver `fonts/OFL.txt`.
- **Tabela de nomes galego-portugueses:** cedida por Marcos Miotti (https://miotti.itch.io/) para a versão brasileira do Cairn. Não faz parte deste sistema.

O código deste fork deriva do [sistema Electric Bastionland](https://github.com/mvdleden/electric-bastionland-FoundryVTT/), via Cairn.
