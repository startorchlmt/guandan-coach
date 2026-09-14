/**
 * 掼蛋军师 · 记牌器：实时统计关键牌的「未出现」张数
 * 未出现 = 总数 − 全场已出（出牌日志） − 我的手牌（明牌）
 * 进贡/还贡只在手牌间转移，不影响「未出现」口径。
 */
import { RANK_LABELS } from './cards.ts';
import type { Card } from './cards.ts';
import type { GuandanHand } from './game.ts';

export interface TrackItem {
  key: string;
  label: string;
  left: number; // 未出现张数（在其余三家手中 + 尚未发出的）
  total: number;
}

export function trackCards(hand: GuandanHand, level: number): TrackItem[] {
  const played: Card[] = hand.log.flatMap((l) => (l.play ? l.play.cards : []));
  const mine = hand.hands[0];
  const left = (pred: (c: Card) => boolean, total: number) =>
    total - played.filter(pred).length - mine.filter(pred).length;

  const items: TrackItem[] = [
    { key: 'bj', label: '大王', left: left((c) => c.rank === 16, 2), total: 2 },
    { key: 'sj', label: '小王', left: left((c) => c.rank === 15, 2), total: 2 },
    { key: 'wild', label: '逢人配', left: left((c) => c.suit === 1 && c.rank === level, 2), total: 2 },
    { key: 'level', label: `级牌${RANK_LABELS[level]}`, left: left((c) => c.rank === level && c.suit !== 1, 6), total: 6 },
  ];
  // A / K / 5 / 10：与级牌重叠的项跳过（级牌条目已覆盖）
  const extras: [string, number][] = [['A', 14], ['K', 13], ['5', 5], ['10', 10]];
  for (const [label, r] of extras) {
    if (r === level) continue;
    items.push({ key: `r${r}`, label, left: left((c) => c.rank === r, 8), total: 8 });
  }
  return items;
}
