/**
 * 掼蛋军师 · 牌的基础模型
 * rank 编码（技术方案 T5 定稿）：2..14 = 2..A，15=小王，16=大王
 * suit：0=♠ 1=♥ 2=♣ 3=♦；王牌 suit = -1
 * 级牌 level ∈ 2..14；红桃级牌（suit=1 && rank=level）为逢人配百搭
 */

export interface Card {
  id: number; // 0..107 全局唯一
  suit: number; // -1 表示王牌
  rank: number; // 2..14=2..A，15=小王，16=大王
}

export const SUIT_SYMBOLS = ['♠', '♥', '♣', '♦'] as const;
export const RANK_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王',
};

export function cardLabel(c: Card): string {
  if (c.suit === -1) return RANK_LABELS[c.rank];
  return `${SUIT_SYMBOLS[c.suit]}${RANK_LABELS[c.rank]}`;
}

export function cardsLabel(cards: Card[]): string {
  return [...cards]
    .sort((a, b) => a.rank - b.rank || a.suit - b.suit)
    .map(cardLabel)
    .join(' ');
}

/** 构建两副牌 108 张 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let d = 0; d < 2; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) deck.push({ id: id++, suit, rank });
    }
    deck.push({ id: id++, suit: -1, rank: 15 });
    deck.push({ id: id++, suit: -1, rank: 16 });
  }
  return deck;
}

/** 是否百搭（逢人配 = 红桃级牌） */
export function isWild(c: Card, level: number): boolean {
  return c.suit === 1 && c.rank === level;
}

/** 是否王牌 */
export function isJoker(c: Card): boolean {
  return c.suit === -1;
}

/**
 * 比较用点数：级牌提升为 14.5（介于 A 与王之间），王牌 15/16 最高。
 * 仅用于大小比较，不用于顺子连续性判断。
 */
export function cmpRank(rank: number, level: number): number {
  if (rank === level) return 14.5;
  return rank;
}

export function cmpCard(a: Card, b: Card, level: number): number {
  return cmpRank(a.rank, level) - cmpRank(b.rank, level);
}

/** 按比较点数排序（升序） */
export function sortCards(cards: Card[], level: number): Card[] {
  return [...cards].sort((a, b) => cmpCard(a, b, level) || a.id - b.id);
}

/** 手牌中最大的一张（进贡用：王牌最大，其次红桃级牌/级牌） */
export function maxCard(cards: Card[], level: number): Card {
  return sortCards(cards, level)[cards.length - 1];
}

/** mulberry32 种子随机 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌 */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
