/**
 * 掼蛋军师 · 对局状态机
 * 一手牌（Game）+ 整局升级（Match）两层。规则口径见需求方案第 3 节。
 */
import { buildDeck, shuffle, mulberry32, sortCards, maxCard, cardLabel, cardsLabel, cmpCard } from './cards.ts';
import type { Card } from './cards.ts';
import { analyze, isBombType, TYPE_NAMES } from './patterns.ts';
import type { Play } from './patterns.ts';
import { decide } from './ai.ts';
import type { AiContext } from './ai.ts';

export type Phase = 'tribute-return' | 'play' | 'done';

export interface TurnLog {
  turn: number;
  seat: number;
  play: Play | null; // null = 不出
  label: string; // 牌面文字
  isBomb: boolean;
  // 教练数据（仅玩家回合填写）
  playerScore?: number;
  coachTopScore?: number;
  verdict?: 'good' | 'ok' | 'suboptimal' | 'blunder';
}

export interface Highlight {
  turn: number;
  seat: number;
  kind: 'jokerbomb' | 'straightflush' | 'bomb' | 'finish' | 'doublewin' | 'comeback';
  text: string;
  weight: number;
}

export interface TributeInfo {
  double: boolean; // 是否双贡
  pairs: { giver: number; receiver: number }[];
  given: Map<number, Card>; // giver -> 贡牌
  returned: Map<number, Card>; // receiver -> 还牌
  resisted: boolean; // 抗贡
  pendingReturn: number[]; // 待还贡的座位（可能含玩家）
}

export interface HandResult {
  order: number[]; // 名次顺序（头游→末游座位）
  myTeamDelta: number; // 玩家队升级数
  headSeat: number;
  doubleDown: boolean;
}

const SEAT_NAMES = ['你(南)', '东家', '搭档(北)', '西家'] as const;
export function seatName(seat: number): string {
  return SEAT_NAMES[seat];
}

export class GuandanHand {
  rng: () => number;
  hands: Card[][] = [[], [], [], []];
  level: number;
  currentSeat = 0;
  lastPlay: Play | null = null;
  lastSeat = -1;
  passCount = 0;
  finished: number[] = []; // 出完顺序
  phase: Phase = 'play';
  log: TurnLog[] = [];
  highlights: Highlight[] = [];
  tribute: TributeInfo | null = null;
  turn = 0;
  roundStartTurn = 1; // 本轮起始回合号（一轮 = 从领出到其余全 pass）
  stepCap = 2000;

  constructor(seed: number, level: number, prevResult: HandResult | null) {
    this.rng = mulberry32(seed);
    this.level = level;
    // 发牌
    const deck = shuffle(buildDeck(), this.rng);
    for (let i = 0; i < 108; i++) this.hands[i % 4].push(deck[i]);
    for (let s = 0; s < 4; s++) this.hands[s] = sortCards(this.hands[s], level);

    // 进贡（首局无）
    if (prevResult) this.setupTribute(prevResult);
    else this.currentSeat = Math.floor(this.rng() * 4);
  }

  private setupTribute(prev: HandResult) {
    const order = prev.order;
    const head = order[0];
    const doubleDown = prev.doubleDown;
    const givers = doubleDown ? [order[3], order[2]] : [order[3]];

    // 抗贡：败方合计持有两张大王
    const bigJokers = givers.reduce(
      (acc, s) => acc + this.hands[s].filter((c) => c.rank === 16).length,
      0,
    );
    const resisted = bigJokers >= 2;

    const given = new Map<number, Card>();
    const returned = new Map<number, Card>();
    const pendingReturn: number[] = [];
    let pairs: { giver: number; receiver: number }[] = [];
    let leadSeat = head; // 抗贡时头游领出

    if (!resisted) {
      // 先抽各贡方的最大牌（红桃级牌=逢人配可免贡，往下找其他大牌）
      const tributes = givers.map((giver) => {
        const pool = this.hands[giver].filter((c) => !(c.suit === 1 && c.rank === this.level));
        const card = maxCard(pool.length > 0 ? pool : this.hands[giver], this.level);
        this.hands[giver] = this.hands[giver].filter((c) => c.id !== card.id);
        return { giver, card, receiver: order[0] };
      });
      // 双贡分配：头游拿大的、二游拿小的；贡大牌的一方先出牌
      if (doubleDown) {
        tributes.sort((a, b) => cmpCard(b.card, a.card, this.level));
        tributes[0].receiver = order[0];
        tributes[1].receiver = order[1];
      }
      leadSeat = tributes[0].giver; // 单贡：进贡方先出；双贡：贡大牌者先出
      pairs = tributes.map((t) => ({ giver: t.giver, receiver: t.receiver }));

      for (const t of tributes) {
        this.hands[t.receiver].push(t.card);
        this.hands[t.receiver] = sortCards(this.hands[t.receiver], this.level);
        given.set(t.giver, t.card);
        // 还贡：AI 自动还小牌；玩家（0 号位）由 UI 选择
        if (t.receiver === 0) {
          pendingReturn.push(t.receiver);
        } else {
          const back = this.pickReturnCard(t.receiver);
          returned.set(t.receiver, back);
          this.hands[t.receiver] = this.hands[t.receiver].filter((c) => c.id !== back.id);
          this.hands[t.giver].push(back);
          this.hands[t.giver] = sortCards(this.hands[t.giver], this.level);
        }
      }
    }

    this.tribute = { double: doubleDown, pairs, given, returned, resisted, pendingReturn };
    this.phase = pendingReturn.length > 0 ? 'tribute-return' : 'play';
    this.currentSeat = leadSeat;
  }

  /** 还贡候选：点数 ≤10 且非级牌（王牌、级牌都不可还） */
  returnCandidates(seat: number): Card[] {
    const cands = this.hands[seat].filter((c) => c.suit !== -1 && c.rank <= 10 && c.rank !== this.level);
    return cands.length > 0 ? cands : [...this.hands[seat]];
  }

  private pickReturnCard(seat: number): Card {
    const cands = this.returnCandidates(seat);
    return sortCards(cands, this.level)[0]; // 还最小的
  }

  /** 玩家还贡（必须是合法候选：≤10 且非级牌；无候选时才放开） */
  playerReturn(cardId: number): boolean {
    if (this.phase !== 'tribute-return' || !this.tribute) return false;
    const seat = 0;
    const card = this.hands[seat].find((c) => c.id === cardId);
    if (!card) return false;
    const strict = this.hands[seat].some((c) => c.suit !== -1 && c.rank <= 10 && c.rank !== this.level);
    if (strict && (card.suit === -1 || card.rank > 10 || card.rank === this.level)) return false;
    const giver = this.tribute.pairs.find((p) => p.receiver === seat)?.giver;
    if (giver === undefined) return false;
    this.hands[seat] = this.hands[seat].filter((c) => c.id !== cardId);
    this.hands[giver].push(card);
    this.hands[giver] = sortCards(this.hands[giver], this.level);
    this.tribute.returned.set(seat, card);
    this.tribute.pendingReturn = this.tribute.pendingReturn.filter((s) => s !== seat);
    if (this.tribute.pendingReturn.length === 0) this.phase = 'play';
    return true;
  }

  /** 当前座位的 AI 上下文 */
  aiContext(seat: number): AiContext {
    const partner = (seat + 2) % 4;
    const opps = [(seat + 1) % 4, (seat + 3) % 4];
    // 被压者（当前大票持有者）是对手时，给出其剩余张数——用炸口诀盯的是这个人
    const winner = this.lastSeat;
    const beatTargetCards = winner >= 0 && winner !== seat && winner !== partner ? this.hands[winner].length : null;
    // 我之后最近一个在局的对手（防止他轻松跟牌走完）
    let nextOppCards: number | undefined;
    for (let k = 1; k <= 3; k++) {
      const s = (seat + k) % 4;
      if (s === partner || this.finished.includes(s)) continue;
      nextOppCards = this.hands[s].length;
      break;
    }
    return {
      seat,
      hand: this.hands[seat],
      level: this.level,
      toBeat: this.passCount > 0 || this.lastSeat !== -1 ? (this.lastSeat === seat ? null : this.lastPlay) : null,
      trickWinner: this.lastSeat === -1 ? null : this.lastSeat,
      partner,
      oppMinCards: Math.min(...opps.map((s) => this.hands[s].length)),
      partnerCards: this.hands[partner].length,
      beatTargetCards,
      nextOppCards,
      rng: this.rng,
    };
  }

  /** 校验并执行一次出牌（play=null 表示不出）。返回错误信息或 null。 */
  play(seat: number, cards: Card[] | null): string | null {
    if (this.phase !== 'play') return '当前不在出牌阶段';
    if (seat !== this.currentSeat) return '还没轮到你';
    if (this.finished.includes(seat)) return '已出完';

    const ctx = this.aiContext(seat);
    let playObj: Play | null = null;
    if (cards && cards.length > 0) {
      // 校验牌确实在手
      const ids = new Set(this.hands[seat].map((c) => c.id));
      if (cards.some((c) => !ids.has(c.id))) return '选了不在手上的牌';
      playObj = analyze(cards, this.level);
      if (!playObj) return '这不是合法牌型（支持：单张/对子/三同/三带二/顺子/连对/钢板/炸弹/同花顺/天王炸）';
      if (ctx.toBeat && !playObjBeats(playObj, ctx.toBeat, this.level)) {
        return `压不过上家的${TYPE_NAMES[ctx.toBeat.type]}`;
      }
    } else {
      if (ctx.toBeat === null) return '轮到你领出，不能不出';
    }

    this.applyPlay(seat, playObj);
    return null;
  }

  private applyPlay(seat: number, playObj: Play | null) {
    this.turn++;
    if (playObj) {
      const ids = new Set(playObj.cards.map((c) => c.id));
      this.hands[seat] = this.hands[seat].filter((c) => !ids.has(c.id));
      this.lastPlay = playObj;
      this.lastSeat = seat;
      this.passCount = 0;
      const bomb = isBombType(playObj.type);
      this.log.push({
        turn: this.turn, seat, play: playObj,
        label: cardsLabel(playObj.cards), isBomb: bomb,
      });
      // 精彩时刻
      if (seat === 0 && bomb) {
        const kind = playObj.type === 'jokerbomb' ? 'jokerbomb' : playObj.type === 'straightflush' ? 'straightflush' : 'bomb';
        const weight = kind === 'jokerbomb' ? 10 : kind === 'straightflush' ? 8 : 5;
        this.highlights.push({ turn: this.turn, seat, kind, weight, text: `第${this.turn}手打出${TYPE_NAMES[playObj.type]}：${cardsLabel(playObj.cards)}` });
      }
      if (this.hands[seat].length === 0 && !this.finished.includes(seat)) {
        this.finished.push(seat);
        this.highlights.push({
          turn: this.turn, seat, kind: 'finish',
          weight: seat === 0 ? (this.finished.length === 1 ? 6 : 3) : 1,
          text: `${seatName(seat)}第 ${this.finished.length} 个出完手牌`,
        });
      }
    } else {
      this.passCount++;
      this.log.push({ turn: this.turn, seat, play: null, label: '不出', isBomb: false });
    }

    // 结算
    // 双下：一队包揽头游二游，立即终局（剩下两家不用再打）
    if (this.finished.length === 2 && this.finished[0] % 2 === this.finished[1] % 2) {
      const rest = [0, 1, 2, 3]
        .filter((s) => !this.finished.includes(s))
        .sort((a, b) => this.hands[a].length - this.hands[b].length);
      this.finished.push(...rest);
      this.highlights.push({
        turn: this.turn, seat: this.finished[0], kind: 'doublewin', weight: 7,
        text: `${[0, 2].includes(this.finished[0]) ? '我方' : '对方'}双下！包揽头游二游，本手提前结束`,
      });
      this.phase = 'done';
      return;
    }
    if (this.finished.length >= 3) {
      const last = [0, 1, 2, 3].find((s) => !this.finished.includes(s))!;
      this.finished.push(last);
      this.phase = 'done';
      return;
    }

    // 轮转：一轮结束（其余在局者均 pass）
    const active = [0, 1, 2, 3].filter((s) => !this.finished.includes(s));
    if (this.passCount >= active.length - 1 && this.lastSeat !== -1) {
      // 本轮 winner 领出；winner 已出完则搭档接风，搭档也完则顺延
      let lead = this.lastSeat;
      if (this.finished.includes(lead)) {
        const partner = (lead + 2) % 4;
        lead = !this.finished.includes(partner) ? partner : active[0];
      }
      this.currentSeat = lead;
      this.lastPlay = null;
      this.lastSeat = -1;
      this.passCount = 0;
      this.roundStartTurn = this.turn + 1;
      return;
    }

    // 下一个未出完者
    let next = (seat + 1) % 4;
    while (this.finished.includes(next)) next = (next + 1) % 4;
    this.currentSeat = next;
  }

  /** 本轮（当前轮次）的出牌记录 */
  roundLog(): TurnLog[] {
    return this.log.filter((l) => l.turn >= this.roundStartTurn);
  }

  /** AI 自动走一步（非玩家座位）。返回是否走出。 */
  autoStep(): boolean {
    if (this.phase !== 'play') return false;
    const seat = this.currentSeat;
    const d = decide(this.aiContext(seat));
    let err = d.play ? this.play(seat, d.play.cards) : this.play(seat, null);
    if (err) {
      // 防御：决策与校验不一致时重试一次
      const g2 = this.aiContext(seat);
      err = g2.toBeat !== null ? this.play(seat, null) : this.play(seat, [this.hands[seat][0]]);
    }
    return err === null;
  }

  /** 结果结算 */
  result(): HandResult {
    const order = [...this.finished];
    const headSeat = order[0];
    const myTeam = [0, 2];
    const headIsMine = myTeam.includes(headSeat);
    const partnerPos = order.indexOf(myTeam.includes(headSeat) ? (headSeat === 0 ? 2 : 0) : 0);
    // 双下：一队包揽一二名（哪队都算，进贡规则中性）
    const doubleDown = order[0] % 2 === order[1] % 2;
    let myTeamDelta = 0;
    if (headIsMine) {
      myTeamDelta = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
    }
    return { order, myTeamDelta, headSeat, doubleDown };
  }
}

function playObjBeats(a: Play, b: Play, level: number): boolean {
  // 局部 import 避免循环：patterns.beat 已导出
  return beatRef(a, b, level);
}
import { beat as beatRef } from './patterns.ts';

// ---------- 整局（升级/打A/胜负） ----------

export interface MatchState {
  levels: [number, number]; // 两队各自级牌
  handOwner: 0 | 1; // 当前级牌属于哪队（头游方定级）
  aFails: [number, number]; // 打 A 连败次数
  over: boolean;
  winner: 0 | 1 | null;
  handCount: number;
}

export function newMatch(): MatchState {
  return { levels: [2, 2], handOwner: 0, aFails: [0, 0], over: false, winner: null, handCount: 0 };
}

/** 一手结束后更新整局状态。返回描述文本。 */
export function advanceMatch(m: MatchState, res: HandResult): string {
  const headTeam: 0 | 1 = [0, 2].includes(res.headSeat) ? 0 : 1;
  const partner = [0, 2].includes(res.headSeat) ? (res.headSeat === 0 ? 2 : 0) : res.headSeat === 1 ? 3 : 1;
  const partnerPos = res.order.indexOf(partner);
  const delta = partnerPos === 1 ? 3 : partnerPos === 2 ? 2 : 1;
  const lv = m.levels[headTeam];
  let text: string;

  if (lv === 14) {
    // 打 A：须头游且搭档非末游
    if (partnerPos <= 2) {
      m.over = true;
      m.winner = headTeam;
      text = `${headTeam === 0 ? '我方' : '对方'}打 A 成功，赢下整局！`;
    } else {
      m.aFails[headTeam]++;
      if (m.aFails[headTeam] >= 3) {
        m.levels[headTeam] = 2;
        m.aFails[headTeam] = 0;
        text = `打 A 三连败，${headTeam === 0 ? '我方' : '对方'}退回 2`;
      } else {
        text = `打 A 失败（搭档末游），继续打 A（${m.aFails[headTeam]}/3）`;
      }
    }
  } else {
    const next = Math.min(14, lv + delta);
    m.levels[headTeam] = next;
    text = `${headTeam === 0 ? '我方' : '对方'}升 ${delta} 级，现在打 ${next === 14 ? 'A' : next}`;
    if (next === 14) m.aFails[headTeam] = 0;
  }
  m.handOwner = headTeam;
  m.handCount++;
  return text;
}

/** 当前手牌的级牌 = 头游方（handOwner）的级别 */
export function handLevel(m: MatchState): number {
  return m.levels[m.handOwner];
}

export { cardLabel, cardsLabel };
