/**
 * 掼蛋军师 · AI 出牌搜索与启发式决策
 * AI 与教练共用同一套候选枚举 + 评分，保证「推荐方案 = AI 认为的最优打法」。
 */
import { isWild, isJoker, cmpRank, cardsLabel } from './cards.ts';
import type { Card } from './cards.ts';
import { analyze, beat, isBombType, TYPE_NAMES } from './patterns.ts';
import type { Play } from './patterns.ts';

// ---------- 手牌结构 ----------

export interface HandStruct {
  byRank: Map<number, Card[]>; // 非百搭按点数分组
  wilds: Card[]; // 逢人配
  jokers: Card[]; // 王
}

export function analyzeHand(hand: Card[], level: number): HandStruct {
  const byRank = new Map<number, Card[]>();
  const wilds: Card[] = [];
  const jokers: Card[] = [];
  for (const c of hand) {
    if (isWild(c, level)) wilds.push(c);
    else if (isJoker(c)) jokers.push(c);
    else {
      const arr = byRank.get(c.rank) ?? [];
      arr.push(c);
      byRank.set(c.rank, arr);
    }
  }
  return { byRank, wilds, jokers };
}

/** 用 group 构造同点牌：先取自然牌，不够用百搭补 */
function buildSameRank(hs: HandStruct, rank: number, n: number): Card[] | null {
  const nat = hs.byRank.get(rank) ?? [];
  if (nat.length > n) return null;
  const need = n - nat.length;
  if (need > hs.wilds.length) return null;
  return [...nat.slice(0, n), ...hs.wilds.slice(0, need)];
}

/** 顺子/连对/钢板窗口（与 patterns.ts 同口径：普通级牌按牌面点数参与；回绕窗口 A-2-3-... 合法） */
function windows(size: number): number[][] {
  const out: number[][] = [];
  for (let s = 2; s + size - 1 <= 14; s++) {
    out.push(Array.from({ length: size }, (_, i) => s + i));
  }
  out.push([14, ...Array.from({ length: size - 1 }, (_, i) => 2 + i)]);
  return out;
}

function windowMain(w: number[]): number {
  return w.includes(14) && w.includes(2)
    ? w.filter((r) => r !== 14).reduce((a, b) => Math.max(a, b), 0)
    : Math.max(...w);
}

/** 构造窗口牌型：每个点取 unitNeed 张，缺了用百搭补 */
function buildWindow(hs: HandStruct, w: number[], unitNeed: number): Card[] | null {
  const out: Card[] = [];
  let wildNeed = 0;
  for (const r of w) {
    const nat = hs.byRank.get(r) ?? [];
    if (nat.length > unitNeed) return null; // 多余牌无法安置
    if (nat.length === 0) wildNeed += unitNeed;
    else {
      out.push(...nat.slice(0, unitNeed));
      wildNeed += unitNeed - Math.min(nat.length, unitNeed);
    }
  }
  if (wildNeed > hs.wilds.length) return null;
  out.push(...hs.wilds.slice(0, wildNeed));
  return out.length > 0 ? out : null;
}

/** 枚举手中所有炸弹（含同花顺、天王炸） */
export function enumerateBombs(hand: Card[], level: number): Play[] {
  const hs = analyzeHand(hand, level);
  const bombs: Play[] = [];
  // 同点炸 4-8
  for (const [rank, cards] of hs.byRank) {
    const maxN = Math.min(8, cards.length + hs.wilds.length);
    for (let n = Math.max(4, cards.length); n <= maxN; n++) {
      const built = buildSameRank(hs, rank, n);
      if (built) {
        const p = analyze(built, level);
        if (p?.type === 'bomb') bombs.push(p);
      }
    }
  }
  // 同花顺
  for (let suit = 0; suit < 4; suit++) {
    const suited = hand.filter((c) => c.suit === suit || isWild(c, level));
    if (suited.length < 5) continue;
    const sub = analyzeHand(suited, level);
    for (const w of windows(5)) {
      const built = buildWindow(sub, w, 1);
      if (built && built.length === 5) {
        const p = analyze(built, level);
        if (p?.type === 'straightflush') bombs.push(p);
      }
    }
  }
  // 天王炸
  if (hs.jokers.length === 4) {
    const p = analyze(hs.jokers, level);
    if (p) bombs.push(p);
  }
  return bombs;
}

const LEAD_CAP = 40;
const RESPONSE_CAP = 30;

/** 领出候选（不含炸弹，除非手牌≤6 张进入残局） */
export function enumerateLeads(hand: Card[], level: number): Play[] {
  const hs = analyzeHand(hand, level);
  const out: Play[] = [];
  const endgame = hand.length <= 6;

  const push = (cards: Card[] | null) => {
    if (!cards || out.length >= LEAD_CAP) return;
    const p = analyze(cards, level);
    if (p) out.push(p);
  };

  // 结构型优先：顺子/连对/钢板
  for (const w of windows(5)) push(buildWindow(hs, w, 1));
  for (const w of windows(3)) push(buildWindow(hs, w, 2));
  for (const w of windows(2)) push(buildWindow(hs, w, 3));

  // 三带二：三条 + 最小对子（残局外不拆 4 张以上的炸弹组）
  const ranksByCount = [...hs.byRank.entries()].sort((a, b) => a[0] - b[0]);
  const bombRanksL = new Set([...hs.byRank.entries()].filter(([, cs]) => cs.length >= 4).map(([r]) => r));
  for (const [t] of ranksByCount) {
    if (!endgame && bombRanksL.has(t)) continue; // 三条不能从炸弹组里拆
    const triple = buildSameRank(hs, t, 3);
    if (!triple) continue;
    for (const [p] of ranksByCount) {
      if (p === t) continue;
      if (!endgame && bombRanksL.has(p)) continue; // 对子也不能从炸弹组里拆（修复"4个8被拆成对子配三带二"）
      const pairCards = (hs.byRank.get(p) ?? []).slice(0, 2);
      if (pairCards.length === 2) push([...triple, ...pairCards]);
    }
  }
  // 三同 / 对子 / 单张（按点升序，炸弹组不拆：count>=4 的组只出整炸）
  for (const [r, cards] of ranksByCount) {
    if (cards.length >= 4 && !endgame) {
      if (cards.length === 4) push(cards); // 残局外仅 4 张整组可当炸领出
      continue;
    }
    if (cards.length >= 3) push(buildSameRank(hs, r, 3));
    if (cards.length >= 2) push(cards.slice(0, 2));
    push(cards.slice(0, 1));
  }
  // 王牌
  const sj = hs.jokers.filter((j) => j.rank === 15);
  const bj = hs.jokers.filter((j) => j.rank === 16);
  if (sj.length >= 2) push(sj.slice(0, 2));
  if (bj.length >= 2) push(bj.slice(0, 2));
  for (const j of hs.jokers) push([j]);
  // 百搭作级牌单张
  if (hs.wilds.length > 0) push(hs.wilds.slice(0, 1));

  // 残局允许炸弹领出
  if (endgame) for (const b of enumerateBombs(hand, level)) push(b.cards);

  return out;
}

/** 压牌候选：同型更大者（尽量小、不拆炸弹组）+ 炸弹（按火力升序），capped */
export function enumerateResponses(hand: Card[], level: number, toBeat: Play): Play[] {
  const hs = analyzeHand(hand, level);
  const out: Play[] = [];
  const target = cmpRank(toBeat.mainRank, level);
  // 炸弹保护：count>=4 的同点组绝不拆散（修复"AI 把四个 J/K 拆成对子"）
  const bombRanks = new Set([...hs.byRank.entries()].filter(([, cs]) => cs.length >= 4).map(([r]) => r));

  const push = (cards: Card[] | null) => {
    if (!cards) return;
    const p = analyze(cards, level);
    if (p && beat(p, toBeat, level)) out.push(p);
  };

  switch (toBeat.type) {
    case 'single': {
      const all = hand
        .filter((c) => cmpRank(c.rank, level) > target)
        .sort((a, b) => cmpRank(a.rank, level) - cmpRank(b.rank, level));
      const safe = all.filter((c) => !bombRanks.has(c.rank) && !isWild(c, level));
      const cands = safe.length > 0 ? safe : all; // 保底：实在没牌才拆
      for (const c of cands.slice(0, 4)) push([c]);
      break;
    }
    case 'pair': {
      for (const [r, cards] of [...hs.byRank.entries()].sort((a, b) => a[0] - b[0])) {
        if (cmpRank(r, level) <= target) continue;
        if (bombRanks.has(r)) continue; // 不拆炸
        if (cards.length >= 2) push(cards.slice(0, 2));
        else if (hs.wilds.length > 0 && out.length === 0) push([...cards, hs.wilds[0]]);
      }
      const sj = hs.jokers.filter((j) => j.rank === 15);
      const bj = hs.jokers.filter((j) => j.rank === 16);
      if (15 > target && sj.length >= 2) push(sj.slice(0, 2));
      if (16 > target && bj.length >= 2) push(bj.slice(0, 2));
      break;
    }
    case 'triple': {
      for (const [r] of [...hs.byRank.entries()].sort((a, b) => a[0] - b[0])) {
        if (cmpRank(r, level) <= target || bombRanks.has(r)) continue;
        push(buildSameRank(hs, r, 3));
      }
      break;
    }
    case 'fullhouse': {
      for (const [t] of [...hs.byRank.entries()].sort((a, b) => a[0] - b[0])) {
        if (cmpRank(t, level) <= target || bombRanks.has(t)) continue;
        const triple = buildSameRank(hs, t, 3);
        if (!triple) continue;
        for (const [p, cards] of hs.byRank) {
          if (p === t || cards.length < 2 || bombRanks.has(p)) continue;
          push([...triple, ...cards.slice(0, 2)]);
        }
      }
      break;
    }
    case 'straight':
    case 'pairseq':
    case 'tripleseq': {
      const size = toBeat.type === 'straight' ? 5 : toBeat.type === 'pairseq' ? 3 : 2;
      const unit = toBeat.type === 'straight' ? 1 : toBeat.type === 'pairseq' ? 2 : 3;
      const rawTarget = toBeat.mainRank; // 序列按牌面值比较：级牌在序列中不提升
      for (const w of windows(size)) {
        if (windowMain(w) <= rawTarget) continue;
        push(buildWindow(hs, w, unit));
      }
      break;
    }
    default:
      break; // 炸弹只能用更大的炸弹压
  }

  // 炸弹候选（火力升序，省着用）
  const bombs = enumerateBombs(hand, level)
    .filter((b) => beat(b, toBeat, level))
    .sort((a, b) => bombOrder(a) - bombOrder(b) || cmpRank(a.mainRank, level) - cmpRank(b.mainRank, level));
  out.push(...bombs.slice(0, 3));

  // 去重 + 截断
  const seen = new Set<string>();
  const uniq = out.filter((p) => {
    const key = p.cards.map((c) => c.id).sort((x, y) => x - y).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return uniq.slice(0, RESPONSE_CAP);
}

function bombOrder(p: Play): number {
  if (p.type === 'jokerbomb') return 7;
  if (p.type === 'straightflush') return 3;
  return p.length <= 4 ? 1 : p.length === 5 ? 2 : p.length - 2;
}

/**
 * 该出牌是否拆散炸弹结构（非炸弹牌型部分使用了炸弹组件）：
 * - 4 张以上同点组被部分消耗
 * - 同花顺（含逢人配替补的）的任意一张被挪用
 * 教练评分/AI 决策统一用它惩罚「拆炸」行为。
 */
export function breaksBombStructure(play: Play, hand: Card[], level: number): boolean {
  if (isBombType(play.type)) return false;
  const ids = new Set(play.cards.map((c) => c.id));
  const hs = analyzeHand(hand, level);
  for (const [, cs] of hs.byRank) {
    if (cs.length >= 4 && cs.some((c) => ids.has(c.id))) return true;
  }
  // 同花顺保护只限「全自然」同花顺；需要百搭替补的属于潜在组合，不硬拦（避免误伤出小单）
  for (const b of enumerateBombs(hand, level)) {
    if (b.type === 'straightflush'
      && !b.cards.some((c) => isWild(c, level))
      && b.cards.some((c) => ids.has(c.id))) return true;
  }
  return false;
}

// ---------- 决策 ----------

/**
 * 软保护：出牌挪用了「需要百搭替补的同花顺」的组件。
 * 不硬拦（避免误伤出小单），但 AI 自己决策时减分避让。
 */
export function usesWildSfCard(play: Play, hand: Card[], level: number): boolean {
  if (isBombType(play.type)) return false;
  const ids = new Set(play.cards.map((c) => c.id));
  return enumerateBombs(hand, level).some(
    (b) => b.type === 'straightflush'
      && b.cards.some((c) => isWild(c, level))
      && b.cards.some((c) => ids.has(c.id)),
  );
}

export interface AiContext {
  seat: number;
  hand: Card[];
  level: number;
  toBeat: Play | null; // 当前须压的牌；null = 领出
  trickWinner: number | null; // 本轮目前最大出牌者座位
  partner: number;
  oppMinCards: number; // 对手方最少剩余张数
  partnerCards: number; // 搭档剩余张数（中局配合策略用）
  beatTargetCards?: number | null; // 被压者（当前大票的持有者，非搭档）的剩余张数——用炸口诀盯的是这个人
  nextOppCards?: number; // 我之后最近一个在局对手的剩余张数（防止他轻松跟牌走完）
  rng?: () => number; // 同分候选随机选择（增加打法多样性）
}

/** 在得分前 eps 范围内的候选中随机挑一个（无 rng 则取最优） */
function pickNearBest<T>(items: T[], scoreFn: (x: T) => number, eps: number, rng?: () => number): T | null {
  if (items.length === 0) return null;
  const scored = items.map((x) => ({ x, s: scoreFn(x) })).sort((a, b) => b.s - a.s);
  const pool = scored.filter((e) => scored[0].s - e.s <= eps);
  const chosen = rng ? pool[Math.floor(rng() * pool.length)] : pool[0];
  return chosen.x;
}

export interface AiDecision {
  play: Play | null; // null = 不出
  score: number; // 决策分（教练用于事中评估）
  reason: string;
}

function playCost(p: Play, level: number, hand: HandStruct): number {
  const seq = p.type === 'straight' || p.type === 'pairseq' || p.type === 'tripleseq' || p.type === 'straightflush';
  let cost = (seq ? p.mainRank : cmpRank(p.mainRank, level)) * 0.1; // 序列按牌面值计成本（级牌在序列中不提升）
  if (isBombType(p.type)) cost += 10 + bombOrder(p) * 2;
  const wildUsed = p.cards.filter((c) => hand.wilds.some((w) => w.id === c.id)).length;
  cost += wildUsed * 3;
  return cost;
}

export function decide(ctx: AiContext): AiDecision {
  const { hand, level, toBeat, rng } = ctx;
  const hs = analyzeHand(hand, level);

  if (toBeat === null) {
    // ---- 领出 ----
    const leads = enumerateLeads(hand, level);
    if (leads.length === 0) return { play: null, score: -999, reason: '无牌可出' };
    const leadScore = (p: Play): number => {
      let s = p.cards.length * 1.2 - playCost(p, level, hs);
      if (p.cards.length === hand.length) s += 100; // 出完即赢
      if (['straight', 'pairseq', 'tripleseq', 'fullhouse'].includes(p.type)) s += 1.5; // 结构型优先
      if (hand.length <= 6) s += p.cards.length * 0.8; // 残局快走
      // 前期不轻易亮大牌/百搭：手牌多时每点高位扣额外分
      if (hand.length > 12) s -= Math.max(0, cmpRank(p.mainRank, level) - 11) * 0.3;
      // 剩 2 张的残局：根据对手余牌灵活决定先大还是先小
      if (hand.length === 2) {
        const om = ctx.oppMinCards;
        if (om === 1) s += cmpRank(p.mainRank, level) * 0.6; // 对手只剩 1 张：必须先出大牌锁死，否则他直接垫走
        else if (om >= 4) s -= cmpRank(p.mainRank, level) * 0.2; // 对手牌还多：先出小单探路，大牌留作后手控制
        else s += cmpRank(p.mainRank, level) * 0.3; // 对手 2-3 张：仍偏大先出，力度减弱
      }
      // 中局配合·送桥：搭档濒临出完且轮我领出，出小单/小对送搭档走牌
      if (ctx.partnerCards <= 3 && hand.length > ctx.partnerCards + 2) {
        if (p.type === 'single' && cmpRank(p.mainRank, level) <= 8) s += 4;
        else if (p.type === 'pair' && cmpRank(p.mainRank, level) <= 8) s += 2.5;
      }
      // 中局压制：对手濒临出完时，领出偏好高强度牌型掌握主动（加成封顶到 K，避免把王/级牌烧在这上面）
      if (ctx.oppMinCards <= 3 && !isBombType(p.type)) s += Math.min(cmpRank(p.mainRank, level), 13) * 0.25;
      // 中局不轻易动王：手牌还多时领出王牌属浪费（残局冲线、一把走完除外）
      if (hand.length > 6 && p.cards.length < hand.length && p.cards.some((c) => c.suit === -1)) s -= 3;
      // 兜底原则：中高位对子/三同领出前，手里要有同型更大牌接得回来，否则一打出去就丢出牌权
      if ((p.type === 'pair' || p.type === 'triple') && hand.length > 6) {
        const unit = p.type === 'pair' ? 2 : 3;
        const hasBackup = [...hs.byRank.entries()].some(([r, cs]) =>
          r !== p.mainRank && cs.length >= unit && cmpRank(r, level) > cmpRank(p.mainRank, level));
        if (!hasBackup && cmpRank(p.mainRank, level) >= 11) s -= 1.2;
      }
      // 拆炸抑制：拆散全自然同花顺或 4 张同点炸弹组的重罚；拆「百搭同花顺」软惩罚避让
      if (breaksBombStructure(p, hand, level)) s -= 8;
      else if (usesWildSfCard(p, hand, level)) s -= 4;
      // 清小单：手里散小单（≤10 的孤张）≥3 张时，先出小单是正道，攒着反而容易被憋死
      if (p.type === 'single' && hand.length > 6 && cmpRank(p.mainRank, level) <= 10 && !isWild(p.cards[0], level)) {
        const looseSingles = [...hs.byRank.entries()].filter(([r, cs]) => cs.length === 1 && r <= 10 && r !== level).length;
        if (looseSingles >= 3) s += 1.2 * looseSingles;
      }
      return s;
    };
    const best = pickNearBest(leads, leadScore, 0.4, rng);
    if (!best) return { play: null, score: -999, reason: '无牌可出' };
    let reason = leadReason(best, hand.length, level, ctx.partnerCards, ctx.oppMinCards);
    // 军师话术：手里有同花顺时明确提醒保留
    const sf = enumerateBombs(hand, level).find((b) => b.type === 'straightflush');
    if (sf && !best.cards.some((c) => sf.cards.some((x) => x.id === c.id))) {
      reason += `（注意：你手里有同花顺 ${cardsLabel(sf.cards)}，留住别拆）`;
    }
    return { play: best, score: leadScore(best), reason };
  }

  // ---- 压牌 ----
  const responses = enumerateResponses(hand, level, toBeat);
  const finish = responses.find((p) => p.cards.length === hand.length);
  if (finish) return { play: finish, score: 100, reason: '此牌出完即走，果断出手' };

  if (ctx.trickWinner === ctx.partner) {
    return { play: null, score: 1, reason: '搭档已控制本轮，不必浪费自己的牌' };
  }
  if (responses.length === 0) {
    return { play: null, score: 0, reason: '没有能压过的牌，保留实力' };
  }
  const nonBombs = responses.filter((p) => !isBombType(p.type));
  const cheapest = pickNearBest(nonBombs, (p) => -playCost(p, level, hs), 0.3, rng);

  if (cheapest) {
    const score = 5 - playCost(cheapest, level, hs);
    return { play: cheapest, score, reason: responseReason(cheapest, level) };
  }
  // 只剩炸弹可压：按口诀「炸九不炸十、炸七不炸八、炸五不炸四、见六就要治」决策
  // 选炸原则：火力小的优先，但「会毁掉手里其他炸弹/同花顺」的炸要重罚
  // （修复：4个3+同花顺时推荐用百搭凑5个3、把同花顺拆成散牌的问题）
  const bombsBefore = enumerateBombs(hand, level).length;
  const pickBomb = (cands: Play[]): Play => {
    let best = cands[0];
    let bestS = Infinity;
    for (const b of cands) {
      const rest = hand.filter((c) => !b.cards.some((x) => x.id === c.id));
      const restHs = analyzeHand(rest, level);
      // 毁掉的其他炸弹数 + 剩余散小单数（拆完留一手散牌最差）
      const destroyed = Math.max(0, bombsBefore - enumerateBombs(rest, level).length);
      const loose = [...restHs.byRank.entries()].filter(([r, cs]) => cs.length === 1 && r <= 10).length;
      const s = bombOrder(b) * 2 + destroyed * 3 + loose * 1.5;
      if (s < bestS) { bestS = s; best = b; }
    }
    return best;
  };
  const bomb = pickBomb(responses);
  const afterLen = hand.length - bomb.cards.length;
  // 盯人目标 = 当前被压的那家（大票持有者）；取不到才退化为对手最少张数
  const opp = ctx.beatTargetCards ?? ctx.oppMinCards;
  const targetDesc = ctx.beatTargetCards != null ? '对方出牌者' : '对手';
  let worthIt = false;
  let why = '';
  if (afterLen <= 2) {
    worthIt = true;
    why = '炸完手牌所剩无几，顺势抢下出牌权收尾';
  } else if (isBombType(toBeat.type)) {
    worthIt = true;
    why = '对手动炸，必须以炸还炸，否则出牌权彻底易手';
  } else if (opp <= 3) {
    worthIt = true;
    why = `${targetDesc}只剩 ${opp} 张，再不拦就直接走了`;
  } else if (opp === 9 || opp === 7 || opp === 6 || opp === 5) {
    worthIt = true;
    why = `${targetDesc}报 ${opp} 张——口诀「${opp === 9 ? '炸九不炸十' : opp === 7 ? '炸七不炸八' : opp === 5 ? '炸五不炸四' : '见六就要治'}」，正是用炸窗口`;
  } else if (ctx.nextOppCards != null && ctx.nextOppCards <= 2) {
    worthIt = true;
    why = `你的下家只剩 ${ctx.nextOppCards} 张，这轮放过去他轻松跟一手就走完了，必须炸停`;
  } else if (opp === 10 || opp === 8) {
    why = `${targetDesc}报 ${opp} 张——口诀「${opp === 10 ? '炸九不炸十' : '炸七不炸八'}」：双数报牌常是一手难尽，炸多半拦不死，留炸等更好的时机`;
  } else if (opp === 4) {
    why = `${targetDesc}报 4 张——口诀「炸五不炸四」：4 张常藏着同花顺/炸弹一把走，炸了也白搭，先忍住`;
  } else {
    why = '只有炸弹能压，对方出牌者牌数还多，留炸备用';
  }
  if (worthIt) {
    return { play: bomb, score: 3 - bombOrder(bomb), reason: `用${TYPE_NAMES[bomb.type]}夺回出牌权：${why}` };
  }
  return { play: null, score: 0.5, reason: why };
}

function leadReason(p: Play, handLen: number, level: number, partnerCards = 99, oppMin = 99): string {
  if (partnerCards <= 3 && handLen > partnerCards + 2
    && (p.type === 'single' || p.type === 'pair') && cmpRank(p.mainRank, level) <= 8) {
    return `搭档只剩 ${partnerCards} 张：出小${p.type === 'single' ? '单' : '对'}送桥，把走牌机会让给搭档`;
  }
  if (p.cards.length === handLen) return '一把出完，直接取胜';
  if (handLen === 2 && p.type === 'single') {
    if (oppMin === 1) return '对手只剩 1 张：必须先出大牌锁死出牌权，否则他直接垫牌走人';
    if (oppMin >= 4 && cmpRank(p.mainRank, level) <= 13) return '对手牌还多：先出小单探路，大牌留作后手控制，两张牌分批走更灵活';
    if (cmpRank(p.mainRank, level) >= 14) return '只剩两张：先出最大牌锁死出牌权，下轮收尾，不给对手截胡的机会';
  }
  if (p.type === 'single' && cmpRank(p.mainRank, level) <= 8) return '先走小单张探路，保留控制力';
  if (isBombType(p.type)) return '残局用炸弹确保出牌权';
  switch (p.type) {
    case 'straight': return '顺子一次走 5 张，快速缩小手牌';
    case 'pairseq': return '连对走牌效率高，且不易被压';
    case 'tripleseq': return '钢板结构难接，适合开路';
    case 'fullhouse': return '三带二顺带清理小对子';
    case 'triple': return '三同中等强度，试探对手牌力';
    case 'pair': return cmpRank(p.mainRank, level) <= 8 ? '先清小对子，保留大牌控制' : '对子开路，观察局势';
    default: return cmpRank(p.mainRank, level) <= 8 ? '先走小单张探路，保留控制力' : '大牌领出，争夺出牌权';
  }
}

function responseReason(p: Play, level: number): string {
  if (isBombType(p.type)) return `用${TYPE_NAMES[p.type]}压过，夺回出牌权`;
  if (cmpRank(p.mainRank, level) >= 14) return '用大牌压过，本轮必须拿下';
  return '用最小代价压过，保持手牌结构完整';
}

/** 计算玩家自选牌的评分（与 decide 同口径，供事中纠正对比） */
export function scoreChoice(ctx: AiContext, play: Play | null): number {
  if (play === null) {
    const d = decide(ctx);
    return d.play === null ? d.score : -2; // 有牌可压却不出 → 低分
  }
  const hs = analyzeHand(ctx.hand, ctx.level);
  if (ctx.toBeat === null) {
    let s = play.cards.length * 1.2 - playCost(play, ctx.level, hs);
    if (play.cards.length === ctx.hand.length) s += 100;
    if (['straight', 'pairseq', 'tripleseq', 'fullhouse'].includes(play.type)) s += 1.5;
    if (ctx.hand.length <= 6) s += play.cards.length * 0.8;
    if (ctx.hand.length > 12) s -= Math.max(0, cmpRank(play.mainRank, ctx.level) - 11) * 0.3;
    if (ctx.hand.length === 2) { // 与 decide 同口径：两单张残局看对手余牌决定先大先小
      const om = ctx.oppMinCards;
      if (om === 1) s += cmpRank(play.mainRank, ctx.level) * 0.6;
      else if (om >= 4) s -= cmpRank(play.mainRank, ctx.level) * 0.2;
      else s += cmpRank(play.mainRank, ctx.level) * 0.3;
    }
    if (ctx.partnerCards <= 3 && ctx.hand.length > ctx.partnerCards + 2) { // 送桥
      if (play.type === 'single' && cmpRank(play.mainRank, ctx.level) <= 8) s += 4;
      else if (play.type === 'pair' && cmpRank(play.mainRank, ctx.level) <= 8) s += 2.5;
    }
    if (ctx.oppMinCards <= 3 && !isBombType(play.type)) s += Math.min(cmpRank(play.mainRank, ctx.level), 13) * 0.25;
    // 中局动王惩罚（与 decide 同口径）
    if (ctx.hand.length > 6 && play.cards.length < ctx.hand.length && play.cards.some((c) => c.suit === -1)) s -= 3;
    // 兜底原则（与 decide 同口径）：无同型更大牌兜底的中高位对子/三同扣分
    if ((play.type === 'pair' || play.type === 'triple') && ctx.hand.length > 6) {
      const unit = play.type === 'pair' ? 2 : 3;
      const hasBackup = [...hs.byRank.entries()].some(([r, cs]) =>
        r !== play.mainRank && cs.length >= unit && cmpRank(r, ctx.level) > cmpRank(play.mainRank, ctx.level));
      if (!hasBackup && cmpRank(play.mainRank, ctx.level) >= 11) s -= 1.2;
    }
    // 拆炸抑制（与 decide 同口径）：拆同花顺/4张同点组重罚
    if (breaksBombStructure(play, ctx.hand, ctx.level)) s -= 8;
    // 清小单（与 decide 同口径）：散小单 ≥3 张时，先出小单是正道
    if (play.type === 'single' && ctx.hand.length > 6 && cmpRank(play.mainRank, ctx.level) <= 10 && !isWild(play.cards[0], ctx.level)) {
      const looseSingles = [...hs.byRank.entries()].filter(([r, cs]) => cs.length === 1 && r <= 10 && r !== ctx.level).length;
      if (looseSingles >= 3) s += 1.2 * looseSingles;
    }
    return s;
  }
  if (!beat(play, ctx.toBeat, ctx.level)) return -999;
  if (play.cards.length === ctx.hand.length) return 100;
  let rs = 5 - playCost(play, ctx.level, hs);
  if (breaksBombStructure(play, ctx.hand, ctx.level)) rs -= 8; // 压牌同样不许拆炸
  return rs;
}
