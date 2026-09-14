/**
 * 掼蛋军师 · 掼力值与段位
 */
export interface Tier {
  name: string;
  min: number;
}

export const TIERS: Tier[] = [
  { name: '掼圣', min: 2800 },
  { name: '大师', min: 2400 },
  { name: '钻石', min: 2050 },
  { name: '铂金', min: 1750 },
  { name: '黄金', min: 1500 },
  { name: '白银', min: 1280 },
  { name: '铜牌', min: 1100 },
  { name: '新手', min: 950 },
  { name: '入门', min: 0 },
];

export function tierOf(rating: number): Tier {
  const r = clampRating(rating);
  return TIERS.find((t) => r >= t.min) ?? TIERS[TIERS.length - 1];
}

export function clampRating(r: number): number {
  const n = Math.round(Number(r));
  if (!Number.isFinite(n)) return 1000;
  return Math.min(4000, Math.max(0, n));
}

/**
 * 每局掼力结算：
 * 基础分 = 胜负（胜 +30 / 负 -30）+ 升级幅度 × 8（胜方）或 对方升级幅度 × -8
 * 决策系数 = 0.6 + 决策准确率 × 0.8（0.6–1.4）
 */
export function ratingDelta(opts: {
  won: boolean; // 整手胜负（头游在我方）
  myDelta: number; // 我方升级数（0/1/2/3）
  oppDelta: number; // 对方升级数
  accuracy: number; // 决策准确率 0-1
  matchOver?: boolean; // 赢下整局额外奖励
}): number {
  const base = opts.won ? 30 + opts.myDelta * 8 : -30 - opts.oppDelta * 8;
  const acc = Math.min(1, Math.max(0, opts.accuracy));
  const factor = 0.6 + acc * 0.8;
  let delta = Math.round(base * factor);
  if (opts.matchOver && opts.won) delta += 50;
  return delta;
}

export const GOLDEN_LINES = [
  '炸弹留到关键时刻，才是真高手。',
  '搭档控场时学会让牌，是掼蛋的第一课。',
  '出牌权比一手牌的大小更值钱。',
  '记牌记不住全部，记住王和级牌就赢一半。',
  '顺风清小牌，逆风保炸弹。',
] as const;

export function goldenLine(seed: number): string {
  return GOLDEN_LINES[Math.abs(seed) % GOLDEN_LINES.length];
}
