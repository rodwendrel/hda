/**
 * Regras B de Herdeiros do Abismo, em funções puras: sem Foundry, sem dados.
 * Quem rola entrega o resultado. É isto que `npm test` exercita.
 *
 * O estado é `{ stability: { value, max }, attunement, insanity, lost, wil }`.
 */

export const MAX_INSANITY = 3;
export const ATTUNEMENT_THRESHOLD = 6;
export const RESONATE_COST = 6;

/** A perda zera a Estabilidade? Só então se rola o 1d3 do máximo. */
export function breaksStability(state, amount) {
  return amount > 0 && state.stability.value - amount <= 0;
}

/**
 * Perda de Estabilidade (seção 6.2). Uma perda gera no máximo 1 Insanidade,
 * e a Estabilidade máxima não acompanha a VON.
 */
export function computeLoss(state, rawAmount, { countsForAttunement = true, maxDrop = 0 } = {}) {
  const amount = Math.max(0, Math.floor(rawAmount));
  const next = structuredClone(state);
  const result = { amount, next, broke: false, overflow: 0, attunementDelta: 0 };
  if (amount === 0) return result;

  if (countsForAttunement && amount >= ATTUNEMENT_THRESHOLD) {
    next.attunement += 1;
    result.attunementDelta += 1;
  }
  next.stability.value -= amount;
  if (next.stability.value <= 0) {
    result.broke = true;
    result.overflow = -next.stability.value;
    next.insanity = Math.min(MAX_INSANITY, next.insanity + 1);
    next.stability.max = Math.max(1, next.stability.max - maxDrop);
    next.attunement += 1;
    result.attunementDelta += 1;
    next.stability.value = next.stability.max;
    if (next.insanity >= MAX_INSANITY) next.lost = true;
    if (result.overflow > 0) next.wil = Math.max(0, next.wil - result.overflow);
  }
  return result;
}

/** Recuperação de Estabilidade. A Sintonia nunca desce abaixo da Insanidade. */
export function computeRecovery(state, rolled) {
  const next = structuredClone(state);
  const gain = Math.min(Math.max(0, next.stability.max - next.stability.value), Math.max(0, rolled));
  next.stability.value += gain;
  let attunementDelta = 0;
  if (gain >= ATTUNEMENT_THRESHOLD && next.attunement > next.insanity) {
    next.attunement -= 1;
    attunementDelta = -1;
  }
  return { gain, next, attunementDelta };
}

/** Teste de VON (seção 6.1): 1 sempre passa, 20 sempre falha. */
export function resolveTest(natural, target) {
  if (natural === 1) return { natural, target, success: true, critical: false };
  if (natural === 20) return { natural, target, success: false, critical: true };
  return { natural, target, success: natural <= target, critical: false };
}

/** A diferença que Forçar custa. */
export function forceCost(natural, target) {
  return Math.max(0, natural - target);
}

export function halve(value) {
  return Math.floor(value / 2);
}

/** Custo na Cicatriz: `extra` é o 2d6+6, usado só no 6. */
export function scarCost(cost, d6, extra = 0) {
  if (d6 === 1) return 0;
  if (d6 <= 3) return halve(cost);
  if (d6 <= 5) return cost * 2;
  return extra;
}

export function manifestationCost(category, bonus = 0) {
  if (category === 'subtle') return '1d6';
  const dice = category === 'violent' ? '2d6' : '1d6';
  return bonus > 0 ? `${dice}+${bonus}` : dice;
}

/** A trilha da Mente: um traço por ponto, ou por 2 pontos acima de 40. */
export function stabilityTrack(value, max) {
  const step = max > 40 ? 2 : 1;
  const track = [];
  for (let point = 0; point < max; point += step) track.push({ off: point >= value });
  return track;
}

export function insanityPips(insanity) {
  return Array.from({ length: MAX_INSANITY }, (_, i) => ({ on: i < insanity, last: i === MAX_INSANITY - 1, value: i + 1 }));
}

/** Clicar no losango N põe N; se ele já estava aceso, N − 1. */
export function nextInsanity(current, clicked) {
  return current >= clicked ? clicked - 1 : clicked;
}

/** Um item por espaço: ocupados, depois Fadiga; o excesso fica marcado. */
export function slotsView(used, max, fatigue) {
  const total = Math.max(used, max);
  const plain = Math.max(0, used - fatigue);
  return Array.from({ length: total }, (_, i) => {
    if (i >= max) return { cls: 'x' };
    if (i < plain) return { cls: 'f' };
    return { cls: i < used ? 'x' : '' };
  });
}

/** A barra do cartão: `''` restante, `n` mudou agora, `l` já faltava. */
export function stabilityBar(from, to, max) {
  return Array.from({ length: max }, (_, i) => {
    if (i < Math.min(from, to)) return { cls: '' };
    return { cls: i < Math.max(from, to) ? 'n' : 'l' };
  });
}

/** O que cada faixa do d66 faz além do texto, pelo início da faixa. */
export const CURSE_AUTOMATION = { 23: 'whisper', 31: 'fever', 51: 'crack', 53: 'mark', 63: 'otherPrice', 65: 'whisper' };

/** Migração do módulo MVP (seção 8.1). Copia as flags para `mind`, sem apagá-las. */
export function migrateMvpFlags(source) {
  const flag = source?.flags?.['herdeiros-do-abismo']?.mente;
  if (!flag || source.type !== 'character' || source.flags.herdeiros?.mvpMigrated) return source;
  if (source.system?.mind?.stability?.max > 0) return source;
  source.system = source.system ?? {};
  source.system.mind = {
    ...source.system.mind,
    stability: { value: flag.estab?.value ?? 0, max: flag.estab?.max ?? 0 },
    attunement: flag.sintonia ?? 0,
    insanity: flag.insanidade ?? 0,
    awakened: flag.desperto ?? false,
    resonating: flag.aberto ?? false,
  };
  return source;
}
