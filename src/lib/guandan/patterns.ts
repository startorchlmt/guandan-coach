/**
 * 掼蛋军师 · 牌型识别与大小比较（含逢人配百搭枚举）
 * 规则口径见 docs/01-需求方案.md 第 3 节。
 */
import { isWild, isJoker, cmpRank } from './cards.ts';
import type { Card } from './cards.ts';

export type PlayType =
  | 'single' | 'pair' | 'triple' | 'fullhouse'
  | 'straight' | 'pairseq' | 'tripleseq'
  | 'bomb' | 'straightflush' | 'jokerbomb';

export interface Play {
  type: PlayType;
  cards: Card[];
  mainRank: number; // 比较主点（原始 rank 值；比较时经 cmpRank 提升级牌）
  length: number;
}

export const TYPE_NAMES: Record<PlayType, string> = {
  single: '单张', pair: '对子', triple: '三同', fullhouse: '三带二',
  straight: '顺子', pairseq: '连对', tripleseq: '钢板',
  bomb: '炸弹', straightflush: '同花顺', jokerbomb: '天王炸',
};

export function isBombType(t: PlayType): boolean {
  return t === 'bomb' || t === 'straightflush' || t === 'jokerbomb';
}

/** 炸弹火力等级：4炸=1 < 5炸=2 < 同花顺=3 < 6炸=4 < 7炸=5 < 8炸=6 < 天王炸=7 */
function bombPower(p: Play): number {
  if (p.type === 'jokerbomb') return 7;
  if (p.type === 'straightflush') return 3;
  if (p.type === 'bomb') {
    if (p.length <= 4) return 1;
    if (p.length === 5) return 2;
    return p.length - 2; // 6→4, 7→5, 8→6
  }
  return 0;
}

/** 顺子/连对/钢板的合法窗口（自然序列 2..A；普通级牌按牌面点数参与，与普通牌无异；A2345 类回绕窗口合法） */
function straightWindows(size: number): number[][] {
  const out: number[][] = [];
  for (let s = 2; s + size - 1 <= 14; s++) {
    out.push(Array.from({ length: size }, (_, i) => s + i));
  }
  // A 作 1 的低位回绕窗口：A-2-3-...（顺子 A2345、连对 AA2233、钢板 AAA222）
  out.push([14, ...Array.from({ length: size - 1 }, (_, i) => 2 + i)]);
  return out;
}

/** 窗口主点：窗口内最大自然点（A2345 的主点为 5） */
function windowMain(w: number[]): number {
  return w.includes(14) && w.includes(2) ? w.filter((r) => r !== 14).reduce((a, b) => Math.max(a, b), 0) : Math.max(...w);
}

interface NaturalInfo {
  counts: Map<number, number>; // 非百搭牌按 rank 计数（王牌也计入）
  wildCount: number;
}

function getNaturals(cards: Card[], level: number): NaturalInfo {
  const counts = new Map<number, number>();
  let wildCount = 0;
  for (const c of cards) {
    if (isWild(c, level)) wildCount++;
    else counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  return { counts, wildCount };
}

/** 尝试构成「k 张同点」：非百搭必须同点，百搭补齐；王不能与百搭混用；全百搭按级牌同点计 */
function fitSameRank(info: NaturalInfo, n: number, level: number): number | null {
  const ranks = [...info.counts.keys()];
  if (ranks.length > 1) return null;
  if (ranks.length === 0) return level; // 仅可能为 2 张百搭 → 级牌对子
  const r = ranks[0];
  if (r >= 15 && info.wildCount > 0) return null; // 百搭不能替代王
  if ((info.counts.get(r) ?? 0) + info.wildCount !== n) return null;
  return r;
}

/** 三带二：枚举三条点 t 与对子点 p */
function fitFullhouse(info: NaturalInfo): number | null {
  for (let t = 2; t <= 14; t++) {
    const ct = info.counts.get(t) ?? 0;
    if (ct > 3) continue;
    for (let p = 2; p <= 14; p++) {
      if (p === t) continue;
      const cp = info.counts.get(p) ?? 0;
      if (cp > 2) continue;
      let others = 0;
      for (const [r, c] of info.counts) if (r !== t && r !== p) others += c;
      if (others > 0) continue;
      if (3 - ct + (2 - cp) === info.wildCount && ct > 0) return t;
    }
  }
  return null;
}

/** 窗口型牌型（顺子/连对/钢板）：unitNeed=每点所需张数(1/2/3) */
function fitWindow(info: NaturalInfo, size: number, unitNeed: number): number | null {
  let best: number | null = null;
  for (const w of straightWindows(size)) {
    let need = 0;
    let ok = true;
    for (const [r, c] of info.counts) {
      if (r >= 15 || !w.includes(r)) { ok = false; break; }
      if (c > unitNeed) { ok = false; break; }
    }
    if (!ok) continue;
    for (const r of w) need += unitNeed - (info.counts.get(r) ?? 0);
    if (need !== info.wildCount) continue;
    const main = windowMain(w);
    if (best === null || main > best) best = main;
  }
  return best;
}

/** 同花顺：窗口 + 非百搭同花色（百搭替补为该花色） */
function fitStraightFlush(cards: Card[], info: NaturalInfo, level: number): number | null {
  const naturals = cards.filter((c) => !isWild(c, level));
  const suits = new Set(naturals.map((c) => c.suit));
  if (suits.size > 1) return null;
  if (naturals.some((c) => c.suit === -1)) return null;
  const main = fitWindow(info, 5, 1);
  if (main === null) return null;
  return main;
}

/**
 * 识别一组牌的最强牌型；不合法返回 null。
 * 含百搭时枚举替补方案。全百搭（1 张级牌单出按单张级牌计）等特殊情形按主流口径处理。
 */
export function analyze(cards: Card[], level: number): Play | null {
  const n = cards.length;
  if (n === 0) return null;
  const info = getNaturals(cards, level);

  // 天王炸：四王（无百搭）
  if (n === 4 && info.wildCount === 0) {
    const ranks = cards.map((c) => c.rank);
    if (ranks.filter((r) => r === 15).length === 2 && ranks.filter((r) => r === 16).length === 2) {
      return { type: 'jokerbomb', cards, mainRank: 16, length: 4 };
    }
  }

  // 炸弹 4-8 张同点
  if (n >= 4 && n <= 8) {
    const r = fitSameRank(info, n, level);
    if (r !== null) return { type: 'bomb', cards, mainRank: r, length: n };
  }

  switch (n) {
    case 1: {
      return { type: 'single', cards, mainRank: cards[0].rank, length: 1 };
    }
    case 2: {
      const r = fitSameRank(info, 2, level);
      return r !== null ? { type: 'pair', cards, mainRank: r, length: 2 } : null;
    }
    case 3: {
      const r = fitSameRank(info, 3, level);
      return r !== null ? { type: 'triple', cards, mainRank: r, length: 3 } : null;
    }
    case 5: {
      const sf = fitStraightFlush(cards, info, level);
      if (sf !== null) return { type: 'straightflush', cards, mainRank: sf, length: 5 };
      const fh = fitFullhouse(info);
      if (fh !== null) return { type: 'fullhouse', cards, mainRank: fh, length: 5 };
      const st = fitWindow(info, 5, 1);
      if (st !== null) return { type: 'straight', cards, mainRank: st, length: 5 };
      return null;
    }
    case 6: {
      const ps = fitWindow(info, 3, 2);
      if (ps !== null) return { type: 'pairseq', cards, mainRank: ps, length: 6 };
      const ts = fitWindow(info, 2, 3);
      if (ts !== null) return { type: 'tripleseq', cards, mainRank: ts, length: 6 };
      return null;
    }
    default:
      return null;
  }
}

/** a 能否压 b（a、b 均已合法识别）。序列类牌型（顺子/连对/钢板/同花顺）按牌面值比较——级牌在序列中不提升 */
export function beat(a: Play, b: Play, level: number): boolean {
  const aBomb = isBombType(a.type);
  const bBomb = isBombType(b.type);
  if (aBomb && !bBomb) return true;
  if (!aBomb && bBomb) return false;
  if (aBomb && bBomb) {
    const pa = bombPower(a);
    const pb = bombPower(b);
    if (pa !== pb) return pa > pb;
    if (a.type === 'straightflush') return a.mainRank > b.mainRank;
    return cmpRank(a.mainRank, level) > cmpRank(b.mainRank, level);
  }
  if (a.type !== b.type || a.length !== b.length) return false;
  if (a.type === 'straight' || a.type === 'pairseq' || a.type === 'tripleseq') {
    return a.mainRank > b.mainRank;
  }
  return cmpRank(a.mainRank, level) > cmpRank(b.mainRank, level);
}

/** 炸弹牌型是否含王（纯辅助） */
export function hasJoker(cards: Card[]): boolean {
  return cards.some(isJoker);
}
