/** Os critérios de aceite da seção 11 que não dependem do Foundry. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attributeDamage, awakensWith, breaksStability, castCost, complicationFor, computeLoss, computeRecovery, costLabel,
  dieUp, fillDice, forceCost, halve, healSplit, insanityPips, migrateManifestation, migrateMvpFlags, nextInsanity,
  resolveTest, scarCost, slotsView, stabilityBar, stabilityFromDie, stabilityTrack,
} from '../scripts/hda/rules.mjs';

const state = (over = {}) => ({
  stability: { value: 20, max: 22 },
  attunement: 0,
  insanity: 0,
  lost: false,
  wil: 12,
  ...over,
});

test('critério 2: transbordo do exemplo do livro', () => {
  const start = state({ stability: { value: 3, max: 20 } });
  assert.ok(breaksStability(start, 8));
  const { next, overflow, attunementDelta } = computeLoss(start, 8, { maxDrop: 2 });
  assert.equal(next.insanity, 1);
  assert.equal(next.attunement, 2);
  assert.equal(next.stability.max, 18);
  assert.equal(next.stability.value, 18);
  assert.equal(overflow, 5);
  assert.equal(attunementDelta, 2);
  assert.equal(next.wil, 7);
});

test('critério 3: perder 5 não mexe na Sintonia', () => {
  const { next } = computeLoss(state(), 5);
  assert.equal(next.stability.value, 15);
  assert.equal(next.attunement, 0);
});

test('critério 4: contam os pontos efetivamente perdidos', () => {
  assert.equal(computeLoss(state(), 3).next.attunement, 0);
});

test('critério 5: a terceira Insanidade perde o personagem, e o contador para em 3', () => {
  const start = state({ stability: { value: 1, max: 10 }, insanity: 2 });
  const { next } = computeLoss(start, 1, { maxDrop: 1 });
  assert.equal(next.insanity, 3);
  assert.equal(next.lost, true);
  const again = computeLoss({ ...next, stability: { value: 1, max: 9 } }, 1, { maxDrop: 1 });
  assert.equal(again.next.insanity, 3);
});

test('critério 6: recuperar 6 respeita o piso da Sintonia', () => {
  const start = state({ stability: { value: 10, max: 20 }, attunement: 2, insanity: 2 });
  const { next, gain } = computeRecovery(start, 6);
  assert.equal(gain, 6);
  assert.equal(next.attunement, 2);
  const above = computeRecovery(state({ stability: { value: 10, max: 20 }, attunement: 3, insanity: 2 }), 6);
  assert.equal(above.next.attunement, 2);
});

test('recuperar não passa do máximo', () => {
  assert.equal(computeRecovery(state({ stability: { value: 21, max: 22 } }), 3).gain, 1);
});

test('uma perda gera no máximo 1 Insanidade', () => {
  const { next } = computeLoss(state({ stability: { value: 1, max: 5 } }), 40, { maxDrop: 3 });
  assert.equal(next.insanity, 1);
  assert.equal(next.wil, 0);
});

test('perda zero não quebra nada, mesmo com Estabilidade 0', () => {
  const { next, broke } = computeLoss(state({ stability: { value: 0, max: 5 } }), 0);
  assert.equal(broke, false);
  assert.equal(next.insanity, 0);
});

test('o máximo não fica abaixo de 1', () => {
  assert.equal(computeLoss(state({ stability: { value: 1, max: 2 } }), 1, { maxDrop: 3 }).next.stability.max, 1);
});

test('Forçar e Ressoar não geram a Sintonia da perda', () => {
  assert.equal(computeLoss(state(), 7, { countsForAttunement: false }).next.attunement, 0);
});

test('critério 9: Forçar custa a diferença', () => {
  const test15 = resolveTest(15, 12);
  assert.equal(test15.success, false);
  assert.equal(forceCost(test15.natural, test15.target), 3);
});

test('critério 10: 1 sempre passa, 20 sempre falha e é crítico', () => {
  assert.equal(resolveTest(1, 0).success, true);
  const nat20 = resolveTest(20, 25);
  assert.equal(nat20.success, false);
  assert.equal(nat20.critical, true);
});

test('critério 11: Cicatriz', () => {
  assert.equal(scarCost(7, 1), 0);
  assert.equal(scarCost(7, 3), 3);
  assert.equal(scarCost(7, 5), 14);
  assert.equal(scarCost(7, 6, 15), 15);
});

test('ajudantes pagam metade, para baixo', () => {
  assert.equal(halve(7), 3);
});

const agonia = { category: 'manifest', costBonus: 2, dice: { contained: 'd4', full: 'd8', unbound: 'd12' } };
const sangria = { category: 'manifest', costBonus: 2, dice: { contained: 'd4', full: 'd10', unbound: 'd12' } };
const remendo = { category: 'manifest', costBonus: 1, dice: { contained: 'd4', full: 'd6', unbound: 'd8' } };

test('critério 8a: Agonia Contida paga só o dado', () => {
  assert.equal(castCost(agonia, 'contained', 3), 3);
});

test('critério 8b: Agonia Desmedida paga o dado e o extra, e chega à Sintonia', () => {
  const cost = castCost(agonia, 'unbound', 9);
  assert.equal(cost, 11);
  assert.equal(computeLoss(state({ stability: { value: 20, max: 22 } }), cost).attunementDelta, 1);
});

test('critério 8c: Violenta é 2d6 + extra, sem intensidade', () => {
  const violent = { category: 'violent', costBonus: 3 };
  assert.equal(castCost(violent, 'contained', 7), 10);
  assert.equal(costLabel(violent, 'full'), '2d6 + 3');
});

test('critério 14 e 14a: Sangria Plena 6 custa 8; Remendo Pleno 4 custa 5', () => {
  assert.equal(castCost(sangria, 'full', 6), 8);
  assert.equal(castCost(remendo, 'full', 4), 5);
});

test('rótulos de custo por intensidade', () => {
  assert.equal(costLabel(agonia, 'contained'), 'd4');
  assert.equal(costLabel(agonia, 'full'), 'd8 + 2');
  assert.equal(costLabel({ category: 'subtle', costBonus: 0, dice: { full: 'd6' } }, 'full'), 'd6');
});

test('[dado] vira o resultado', () => {
  assert.equal(fillDice('por [dado] minutos, raio [dado] × 3 m', 5), 'por <b>5</b> minutos, raio <b>5</b> × 3 m');
});

test('critério 15a: Estase em DES 10, dano 5 dispara; dano 4 não', () => {
  assert.deepEqual(attributeDamage(10, 10, 5), { before: 10, after: 5, triggered: true, zero: false });
  assert.equal(attributeDamage(10, 10, 4).triggered, false);
});

test('critério 16: dano de VON 4 em VON 3 zera', () => {
  assert.equal(attributeDamage(3, 12, 4).zero, true);
});

test('Remendo divide os pontos sem passar do máximo', () => {
  const stats = { str: { value: 8, max: 10 }, dex: { value: 5, max: 12 } };
  assert.deepEqual(healSplit(stats, 4, 3), { str: 10, dex: 7 });
  assert.deepEqual(healSplit(stats, 4, 0), { str: 8, dex: 9 });
});

test('complicações pelo d6', () => {
  assert.equal(complicationFor(1), 'wrongTarget');
  assert.equal(complicationFor(2), 'half');
  assert.equal(complicationFor(6), 'mark');
});

test('critérios 1, 15c e 15d: um d6 dá a Estabilidade e o despertar', () => {
  assert.equal(stabilityFromDie(12, 4), 22);
  assert.equal(awakensWith(4), false);
  assert.equal(stabilityFromDie(12, 6), 24);
  assert.equal(awakensWith(6), true);
  assert.equal(awakensWith(5, true), true);
  assert.equal(awakensWith(5, false), false);
});

test('migração de Manifestação antiga', () => {
  const old = { effectFormula: 'd8', hpCost: '2', healStabilityLoss: '1d6' };
  migrateManifestation(old);
  assert.deepEqual(old.dice, { contained: 'd4', full: 'd8', unbound: 'd12' });
  assert.deepEqual(old.hpCost, { contained: 1, full: 2, unbound: 3 });
  assert.equal('effectFormula' in old, false);
  assert.equal(dieUp('d10'), 'd12');
});

test('trilha agrupa acima de 40', () => {
  assert.equal(stabilityTrack(5, 10).length, 10);
  assert.equal(stabilityTrack(5, 10).filter((p) => p.off).length, 5);
  assert.equal(stabilityTrack(10, 44).length, 22);
});

test('losangos: clicar no aceso apaga', () => {
  assert.deepEqual(insanityPips(1).map((p) => p.on), [true, false, false]);
  assert.equal(insanityPips(0)[2].last, true);
  assert.equal(nextInsanity(2, 2), 1);
  assert.equal(nextInsanity(1, 3), 3);
  assert.equal(nextInsanity(1, 1), 0);
});

test('espaços: ocupado, Fadiga, livre e excesso', () => {
  assert.deepEqual(slotsView(3, 4, 1).map((s) => s.cls), ['f', 'f', 'x', '']);
  assert.deepEqual(slotsView(5, 4, 0).map((s) => s.cls), ['f', 'f', 'f', 'f', 'x']);
});

test('barra do cartão', () => {
  assert.deepEqual(stabilityBar(3, 1, 4).map((s) => s.cls), ['', 'n', 'n', 'l']);
});

test('migração do módulo MVP copia sem apagar a flag', () => {
  const mente = { estab: { value: 9, max: 21 }, sintonia: 2, insanidade: 1, desperto: true, aberto: true };
  const source = { type: 'character', system: {}, flags: { 'herdeiros-do-abismo': { mente } } };
  migrateMvpFlags(source);
  assert.deepEqual(source.system.mind.stability, { value: 9, max: 21 });
  assert.equal(source.system.mind.attunement, 2);
  assert.equal(source.system.mind.insanity, 1);
  assert.equal(source.system.mind.awakened, true);
  assert.equal(source.system.mind.resonating, true);
  assert.ok(source.flags['herdeiros-do-abismo'].mente);
});

test('migração funciona sem system, e uma vez só', () => {
  const flags = { 'herdeiros-do-abismo': { mente: { estab: { value: 9, max: 21 } } } };
  assert.equal(migrateMvpFlags({ type: 'character', flags: { ...flags } }).system.mind.stability.value, 9);
  const done = { type: 'character', system: {}, flags: { ...flags, herdeiros: { mvpMigrated: true } } };
  assert.equal(migrateMvpFlags(done).system.mind, undefined);
});

test('migração não pisa em mente já preenchida', () => {
  const source = {
    type: 'character',
    system: { mind: { stability: { value: 1, max: 5 } } },
    flags: { 'herdeiros-do-abismo': { mente: { estab: { value: 9, max: 21 } } } },
  };
  migrateMvpFlags(source);
  assert.equal(source.system.mind.stability.max, 5);
});
