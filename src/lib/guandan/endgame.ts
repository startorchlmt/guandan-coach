/**
 * 掼蛋军师 · 残局模式：求解器 + 生成器 + 逐步复盘
 * 目标：己方（南 0 / 北 2 号位）拿到头游（全场第一个出完）。
 * 极小牌力下穷举博弈树（带记忆化），保证残局「只有唯一取胜着法」。
 */
import { buildDeck, cardsLabel } from './cards.ts';
import type { Card } from './cards.ts';
import { isBombType, TYPE_NAMES } from './patterns.ts';
import type { Play } from './patterns.ts';
import { decide, enumerateLeads, enumerateResponses } from './ai.ts';
import type { AiContext } from './ai.ts';

// ---------- 局面 ----------

export interface EndState {
  hands: Card[][];
  seat: number; // 行动方；-1 = 已分出头游
  lastPlay: Play | null;
  lastSeat: number; // -1 = 新一轮领出
  passCount: number;
  finished: number[]; // 头游决定即终局（只关心第一个出完者）
  level: number;
}

export function initialState(hands: Card[][], level: number): EndState {
  return { hands, seat: 0, lastPlay: null, lastSeat: -1, passCount: 0, finished: [], level };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 当前座位全部合法着法（含「不出」；领出时必出牌）。
 *  战略等价着法去重：牌型+主点+张数+百搭数相同视为同一着（大幅压缩搜索树） */
export function legalMoves(s: EndState): (Play | null)[] {
  const hand = s.hands[s.seat];
  const raw = s.lastSeat === -1 || s.lastSeat === s.seat
    ? enumerateLeads(hand, s.level)
    : [...enumerateResponses(hand, s.level, s.lastPlay!), null];
  const seen = new Set<string>();
  return raw.filter((m) => {
    if (m === null) return true;
    const wildN = m.cards.filter((c) => c.suit === 1 && c.rank === s.level).length;
    const key = `${m.type}#${m.mainRank}#${m.length}#${wildN}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 应用一着，返回新局面（头游产生即终局） */
export function applyMove(s: EndState, m: Play | null): EndState {
  const hands = s.hands.map((h) => [...h]);
  let { lastPlay, lastSeat, passCount } = s;
  const finished = [...s.finished];
  if (m) {
    const ids = new Set(m.cards.map((c) => c.id));
    hands[s.seat] = hands[s.seat].filter((c) => !ids.has(c.id));
    lastPlay = m;
    lastSeat = s.seat;
    passCount = 0;
    if (hands[s.seat].length === 0) finished.push(s.seat);
  } else {
    passCount++;
  }
  if (finished.length > 0) {
    return { hands, seat: -1, lastPlay, lastSeat, passCount, finished, level: s.level };
  }
  const active = [0, 1, 2, 3].filter((x) => !finished.includes(x));
  let seat: number;
  if (passCount >= active.length - 1 && lastSeat !== -1) {
    seat = lastSeat; // 本轮最大者领出
    lastPlay = null;
    lastSeat = -1;
    passCount = 0;
  } else {
    seat = (s.seat + 1) % 4;
  }
  return { hands, seat, lastPlay, lastSeat, passCount, finished, level: s.level };
}

// ---------- 求解器（minimax + 记忆化 + 生成期节点预算） ----------

const memo = new Map<string, boolean>();
let nodes = 0;
let budgetOn = false; // 仅在生成残局时启用预算，实战对局不受限
const NODE_CAP = 120_000;
class SearchOverflow extends Error {}

export function clearSolver(): void {
  memo.clear();
  nodes = 0;
}

function keyOf(s: EndState): string {
  const hs = s.hands.map((h) => h.map((c) => c.id).sort((a, b) => a - b).join(',')).join('|');
  const lp = s.lastPlay ? s.lastPlay.cards.map((c) => c.id).sort((a, b) => a - b).join(',') : 'L';
  return `${hs}#${s.seat}#${s.lastSeat}#${s.passCount}#${lp}`;
}

/** 己方（0/2 号位）能否拿到头游：teamA 取 max，对方取 min */
export function winTeamA(s: EndState): boolean {
  if (s.finished.length > 0) return s.finished[0] % 2 === 0;
  const key = keyOf(s);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  if (budgetOn && ++nodes > NODE_CAP) throw new SearchOverflow();
  const moves = legalMoves(s);
  const teamA = s.seat % 2 === 0;
  const res = teamA
    ? moves.some((m) => winTeamA(applyMove(s, m)))
    : moves.every((m) => winTeamA(applyMove(s, m)));
  memo.set(key, res);
  return res;
}

/** 当前局面的全部取胜着法 */
export function winningMoves(s: EndState): (Play | null)[] {
  return legalMoves(s).filter((m) => winTeamA(applyMove(s, m)));
}

function samePlay(a: Play | null, b: Play | null): boolean {
  if (a === null || b === null) return a === b;
  const ka = a.cards.map((c) => c.id).sort((x, y) => x - y).join(',');
  const kb = b.cards.map((c) => c.id).sort((x, y) => x - y).join(',');
  return ka === kb;
}

// ---------- 残局定义 ----------

export interface Puzzle {
  level: number;
  hands: Card[][];
  solution: Play; // 唯一取胜首着
  classic?: string; // 经典残局名
}

function mk(id: number, rank: number, suit: number): Card {
  return { id, suit: rank >= 15 ? -1 : suit, rank };
}

/** 经典残局（均经求解器验证唯一解，测试锁定） */
export const CLASSICS: { name: string; puzzle: () => Puzzle }[] = [
  {
    name: '大王锁喉',
    puzzle: () => {
      // 南 {9, 大王}，下家东仅 1 张 J：先出 9 会被东截走头游，必须先大王
      const hands = [
        [mk(1, 9, 0), mk(2, 16, -1)],
        [mk(3, 11, 0)],
        [mk(4, 3, 0)],
        [mk(5, 13, 0), mk(6, 12, 1), mk(7, 5, 3)],
      ];
      const s = initialState(hands, 2);
      const wm = winningMoves(s);
      return { level: 2, hands, solution: wm[0]!, classic: '大王锁喉' };
    },
  },
  {
    name: '对子续命',
    puzzle: () => {
      // 南 {对K, 4}：先出对 K 再出 4 可胜；先出 4 则对 K 被拆穿
      const hands = [
        [mk(11, 13, 0), mk(12, 13, 1), mk(13, 4, 3)],
        [mk(14, 14, 0)],
        [mk(15, 3, 0)],
        [mk(16, 12, 0), mk(17, 12, 2), mk(18, 6, 3)],
      ];
      const s = initialState(hands, 2);
      const wm = winningMoves(s);
      return { level: 2, hands, solution: wm[0]!, classic: '对子续命' };
    },
  },
];

/** 随机生成唯一解残局：南 3-4 张，其余 2-3 张；首着唯一且不能一把出完 */
export function genPuzzle(seed: number, level: number): Puzzle | null {
  return genPuzzleD(seed, level, 'mid');
}

// ---------- 难度分级 ----------

export type Difficulty = 'easy' | 'mid' | 'hard';

export const DIFF_INFO: Record<Difficulty, { name: string; score: number; desc: string }> = {
  easy: { name: '入门', score: 60, desc: '3-4 张小残局' },
  mid: { name: '进阶', score: 100, desc: '4-6 张标准残局' },
  hard: { name: '高手', score: 160, desc: '6-10 张复杂残局，随机级牌含逢人配' },
};

/** 按已破解数自动升档：0-2 入门，3-7 进阶，8+ 高手 */
export function diffOfSolved(solved: number): Difficulty {
  if (solved >= 8) return 'hard';
  if (solved >= 3) return 'mid';
  return 'easy';
}

/** 按难度随机生成唯一解残局；高手档使用随机级牌且保证逢人配入局 */
export function genPuzzleD(seed: number, level: number, diff: Difficulty): Puzzle | null {
  const ranges: Record<Difficulty, [number, number][]> = {
    easy: [[3, 4], [2, 3], [2, 3], [2, 3]],
    mid: [[4, 6], [3, 4], [3, 4], [3, 4]],
    hard: [[6, 10], [3, 4], [3, 4], [3, 4]],
  };
  const [r0, r1, r2, r3] = ranges[diff];
  // 外层 3 轮换种子重试，提高高手档出题成功率
  for (let round = 0; round < 3; round++) {
    const rng = mulberry32(seed + round * 1000003);
    const pick = ([lo, hi]: [number, number]) => lo + Math.floor(rng() * (hi - lo + 1));
    for (let i = 0; i < 400; i++) {
      // 高手档：随机级牌（2..A），逢人配随之变化
      const lv = diff === 'hard' ? 2 + Math.floor(rng() * 13) : level;
      const deck = [...buildDeck()];
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      const sizes = [pick(r0), pick(r1), pick(r2), pick(r3)];
      const hands: Card[][] = [];
      let p = 0;
      for (const sz of sizes) { hands.push(deck.slice(p, p + sz)); p += sz; }
      // 高手档：必须有逢人配（红桃级牌）入局
      if (diff === 'hard' && !hands.some((h) => h.some((c) => c.suit === 1 && c.rank === lv))) continue;
      const s = initialState(hands, lv);
      let wm: (Play | null)[];
      clearSolver(); // 每次尝试重置记忆表与节点计数，防止内存膨胀
      budgetOn = true;
      try {
        wm = winningMoves(s);
      } catch {
        continue; // 搜索超限，放弃本次尝试
      } finally {
        budgetOn = false;
      }
      if (wm.length !== 1 || wm[0] === null) continue;
      const sol = wm[0];
      if (sol.cards.length === hands[0].length) continue; // 一把出完太直白
      if (isBombType(sol.type) && hands[0].length <= 4) continue; // 无脑开炸太直白
      return { level: lv, hands, solution: sol };
    }
  }
  return null;
}

// ---------- 复盘 ----------

export interface LineStep {
  seat: number;
  label: string;
  mine: boolean;
  verdict: 'correct' | 'wrong' | 'moot' | 'ai';
  bestLabel?: string;
  reason?: string;
}

export interface LineReport {
  steps: LineStep[];
  solved: boolean; // 我的每一手都在取胜集合中
  headIsMine: boolean; // 实际对局己方是否头游
  pv: string[]; // 正确线路（从初始局面）
}

function explainMove(s: EndState, p: Play | null): string {
  if (!p) return '此时按兵不动：留住关键牌张，等对手把出牌权送回来';
  const before = s.hands[s.seat].length;
  const left = before - p.cards.length;
  if (left === 0) return `出 ${cardsLabel(p.cards)} 一把走完，直接锁定头游`;
  if (before === 2 && p.type === 'single') {
    return '只剩两张：必须先出大牌锁死出牌权——先出小牌会被对手截走头游';
  }
  if (isBombType(p.type)) return `唯一胜机：必须用${TYPE_NAMES[p.type]}夺回出牌权，犹豫就会败北`;
  const partnerLeft = s.hands[(s.seat + 2) % 4].length;
  if (partnerLeft <= 2 && (p.type === 'single' || p.type === 'pair')) {
    return `出小${p.type === 'single' ? '单' : '对'}送桥：搭档只剩 ${partnerLeft} 张，把走牌机会喂给他`;
  }
  return `只有 ${cardsLabel(p.cards)} 能保证己方头游——其它着法都会被对手抓住破绽`;
}

/** 用引擎启发式为对方选择着法（实战/正确线路演示用） */
export function heuristicMove(s: EndState): Play | null {
  const ctx: AiContext = {
    seat: s.seat,
    hand: s.hands[s.seat],
    level: s.level,
    toBeat: s.lastSeat === -1 || s.lastSeat === s.seat ? null : s.lastPlay,
    trickWinner: s.lastSeat === -1 ? null : s.lastSeat,
    partner: (s.seat + 2) % 4,
    oppMinCards: Math.min(s.hands[(s.seat + 1) % 4].length, s.hands[(s.seat + 3) % 4].length),
    partnerCards: s.hands[(s.seat + 2) % 4].length,
  };
  return decide(ctx).play;
}

/** 为己方座位选着：有取胜着法走胜着，否则启发式 */
export function teamAMove(s: EndState): Play | null {
  const wm = winningMoves(s);
  if (wm.length > 0) return wm[0];
  return heuristicMove(s);
}

/** 逐步复盘：重演实际行棋，在每个我的决策点对答案 */
export function evaluateLine(puzzle: Puzzle, moves: { seat: number; play: Play | null }[], headSeat: number): LineReport {
  let s = initialState(puzzle.hands.map((h) => [...h]), puzzle.level);
  let lost = false;
  const steps: LineStep[] = [];
  for (const mv of moves) {
    if (mv.seat === 0) {
      if (lost) {
        steps.push({ seat: 0, label: mv.play ? cardsLabel(mv.play.cards) : '不出', mine: true, verdict: 'moot' });
      } else {
        const wm = winningMoves(s);
        const ok = wm.some((w) => samePlay(w, mv.play));
        if (ok) {
          steps.push({ seat: 0, label: mv.play ? cardsLabel(mv.play.cards) : '不出', mine: true, verdict: 'correct', reason: explainMove(s, mv.play) });
        } else {
          lost = true;
          const best = wm[0] ?? null;
          steps.push({
            seat: 0, label: mv.play ? cardsLabel(mv.play.cards) : '不出', mine: true, verdict: 'wrong',
            bestLabel: best ? cardsLabel(best.cards) : '不出',
            reason: best ? explainMove(s, best) : undefined,
          });
        }
      }
    } else {
      steps.push({ seat: mv.seat, label: mv.play ? cardsLabel(mv.play.cards) : '不出', mine: false, verdict: 'ai' });
    }
    s = applyMove(s, mv.play);
  }
  return {
    steps,
    solved: !lost,
    headIsMine: headSeat % 2 === 0,
    pv: principalVariation(puzzle),
  };
}

/** 正确线路演示：己方走胜着，对方走启发式最强抵抗 */
export function principalVariation(puzzle: Puzzle): string[] {
  let s = initialState(puzzle.hands.map((h) => [...h]), puzzle.level);
  const names = ['南(你)', '东', '北(搭档)', '西'];
  const out: string[] = [];
  let guard = 0;
  while (s.finished.length === 0 && guard++ < 40) {
    const m = s.seat % 2 === 0 ? (winningMoves(s)[0] ?? heuristicMove(s)) : heuristicMove(s);
    out.push(`${names[s.seat]}：${m ? cardsLabel(m.cards) : '不出'}`);
    s = applyMove(s, m);
  }
  return out;
}
