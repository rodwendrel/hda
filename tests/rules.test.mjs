/** Os critérios de aceite da seção 11 que não dependem do Foundry. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  breaksStability, computeLoss, computeRecovery, forceCost, halve, insanityPips, manifestationCost, migrateMvpFlags,
  nextInsanity, resolveTest, scarCost, slotsView, stabilityBar, stabilityTrack,
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

test('custos por categoria', () => {
  assert.equal(manifestationCost('subtle', 3), '1d6');
  assert.equal(manifestationCost('manifest', 2), '1d6+2');
  assert.equal(manifestationCost('violent', 3), '2d6+3');
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
