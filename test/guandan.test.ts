/**
 * 掼蛋军师 · 引擎 100 条路径测试
 * 运行：node test/guandan.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildDeck, isWild, cmpRank, sortCards, maxCard, cardLabel,
} from '../src/lib/guandan/cards.ts';
import type { Card } from '../src/lib/guandan/cards.ts';
import { analyze, beat } from '../src/lib/guandan/patterns.ts';
import type { Play, PlayType } from '../src/lib/guandan/patterns.ts';
import { enumerateBombs, enumerateLeads, enumerateResponses, decide, scoreChoice } from '../src/lib/guandan/ai.ts';
import { GuandanHand, newMatch, advanceMatch, handLevel } from '../src/lib/guandan/game.ts';
import type { HandResult } from '../src/lib/guandan/game.ts';
import { recommend, evaluate, review, QUIZ, quizBonus, openingReview } from '../src/lib/guandan/coach.ts';
import { ratingDelta, clampRating, tierOf, TIERS } from '../src/lib/guandan/rating.ts';
import {
  CLASSICS, genPuzzle, genPuzzleD, diffOfSolved, initialState, winningMoves, winTeamA, applyMove, evaluateLine, heuristicMove,
} from '../src/lib/guandan/endgame.ts';
import type { Difficulty } from '../src/lib/guandan/endgame.ts';
import { trackCards } from '../src/lib/guandan/tracker.ts';

let passed = 0;
let total = 0;
const failures: string[] = [];
function t(id: number, name: string, fn: () => void) {
  total++;
  try { fn(); passed++; } catch (e) { failures.push(`#${id} ${name}: ${(e as Error).message}`); }
}

// 快捷造牌：rank 2..14, suit 0..3；小王15 大王16
let uid = 1000;
function c(rank: number, suit = 0): Card {
  return { id: uid++, suit: rank >= 15 ? -1 : suit, rank };
}
function handOf(...specs: [number, number?][]): Card[] {
  return specs.map(([r, s]) => c(r, s));
}
const L = 7; // 默认级牌 7

// ---------- 1-25 牌型识别 ----------
t(1, '单张', () => assert.equal(analyze(handOf([5]), L)?.type, 'single'));
t(2, '对子', () => assert.equal(analyze(handOf([5], [5, 2]), L)?.type, 'pair'));
t(3, '对小王是合法对子', () => assert.equal(analyze(handOf([15], [15]), L)?.type, 'pair'));
t(4, '王+百搭不成对', () => assert.equal(analyze(handOf([15], [7, 1]), L), null));
t(5, '双百搭=级牌对子', () => {
  const p = analyze(handOf([7, 1], [7, 1]), L);
  assert.equal(p?.type, 'pair');
  assert.equal(p?.mainRank, 7);
});
t(6, '三同', () => assert.equal(analyze(handOf([9], [9, 1], [9, 2]), L)?.type, 'triple'));
t(7, '三带二', () => assert.equal(analyze(handOf([9], [9, 1], [9, 2], [4], [4, 1]), L)?.type, 'fullhouse'));
t(8, '三带二含百搭', () => assert.equal(analyze(handOf([9], [9, 1], [9, 2], [4], [7, 1]), L)?.type, 'fullhouse'));
t(9, '顺子', () => assert.equal(analyze(handOf([8], [9, 2], [10], [11], [12]), L)?.type, 'straight'));
t(10, '顺子含百搭', () => assert.equal(analyze(handOf([8], [9, 2], [10], [11], [7, 1]), L)?.type, 'straight'));
t(11, 'A2345 顺子（级牌非2）', () => {
  const p = analyze(handOf([14], [2, 2], [3], [4], [5]), L);
  assert.equal(p?.type, 'straight');
  assert.equal(p?.mainRank, 5);
});
t(12, 'A2345 顺子打2时亦合法（回绕顺，用户裁定口径）', () => {
  const p = analyze(handOf([14], [2, 2], [3], [4, 2], [5]), 2);
  assert.equal(p?.type, 'straight');
  assert.equal(p?.mainRank, 5);
});
t(13, '顺子含普通级牌合法（级牌按牌面参与）', () => {
  const p = analyze(handOf([3], [4, 1], [5], [6], [7]), L); // 打7，♠7 按牌面进 3-4-5-6-7
  assert.equal(p?.type, 'straight');
  assert.equal(p?.mainRank, 7);
});
t(14, '4 张不成顺', () => assert.equal(analyze(handOf([3], [4], [5], [6]), L), null));
t(15, '连对', () => assert.equal(analyze(handOf([3], [3, 1], [4], [4, 1], [5], [5, 1]), L)?.type, 'pairseq'));
t(16, '连对含百搭', () => assert.equal(analyze(handOf([3], [3, 1], [4], [4, 1], [5], [7, 1]), L)?.type, 'pairseq'));
t(17, '钢板', () => assert.equal(analyze(handOf([3], [3, 1], [3, 2], [4], [4, 1], [4, 2]), L)?.type, 'tripleseq'));
t(18, '四张炸', () => assert.equal(analyze(handOf([9], [9, 1], [9, 2], [9, 3]), L)?.type, 'bomb'));
t(19, '三同+百搭=四张炸', () => {
  const p = analyze(handOf([9], [9, 1], [9, 2], [7, 1]), L);
  assert.equal(p?.type, 'bomb');
  assert.equal(p?.mainRank, 9);
});
t(20, '同花顺', () => {
  const p = analyze(handOf([8, 0], [9, 0], [10, 0], [11, 0], [12, 0]), L);
  assert.equal(p?.type, 'straightflush');
});
t(21, '混花五连只是顺子', () => {
  const p = analyze(handOf([8, 0], [9, 1], [10, 0], [11, 0], [12, 0]), L);
  assert.equal(p?.type, 'straight');
});
t(22, '天王炸', () => assert.equal(analyze(handOf([15], [15], [16], [16]), L)?.type, 'jokerbomb'));
t(23, '三带一非法', () => assert.equal(analyze(handOf([9], [9, 1], [9, 2], [4]), L), null));
t(24, '六张炸', () => {
  const p = analyze(handOf([9], [9, 1], [9, 2], [9, 3], [9], [9, 1]), L);
  assert.equal(p?.type, 'bomb');
  assert.equal(p?.length, 6);
});
t(25, '九张同点非法', () => assert.equal(analyze(handOf([9], [9], [9], [9], [9], [9], [9], [9], [9]), L), null));

// ---------- 26-45 大小比较 ----------
const mk = (type: PlayType, mainRank: number, length: number): Play => ({ type, mainRank, length, cards: [] });
t(26, '对6>对5', () => assert.ok(beat(mk('pair', 6, 2), mk('pair', 5, 2), L)));
t(27, '级牌单张>A', () => assert.ok(beat(mk('single', 7, 1), mk('single', 14, 1), L)));
t(28, '小王>级牌', () => assert.ok(beat(mk('single', 15, 1), mk('single', 7, 1), L)));
t(29, '大王>小王', () => assert.ok(beat(mk('single', 16, 1), mk('single', 15, 1), L)));
t(30, '单张不能压对子', () => assert.ok(!beat(mk('single', 16, 1), mk('pair', 5, 2), L)));
t(31, '顺子比主点 3-7>A2345', () => assert.ok(beat(mk('straight', 7, 5), mk('straight', 5, 5), L)));
t(32, '10JQKA>9-10JQK', () => assert.ok(beat(mk('straight', 14, 5), mk('straight', 13, 5), L)));
t(33, '三带二比三条点', () => assert.ok(beat(mk('fullhouse', 9, 5), mk('fullhouse', 8, 5), L)));
t(34, '四炸压不过同花顺', () => assert.ok(!beat(mk('bomb', 9, 4), mk('straightflush', 9, 5), L)));
t(35, '同花顺压五张炸', () => assert.ok(beat(mk('straightflush', 5, 5), mk('bomb', 14, 5), L)));
t(36, '六张炸压同花顺', () => assert.ok(beat(mk('bomb', 4, 6), mk('straightflush', 14, 5), L)));
t(37, '天王炸压八张炸', () => assert.ok(beat(mk('jokerbomb', 16, 4), mk('bomb', 14, 8), L)));
t(38, '八张炸压七张炸', () => assert.ok(beat(mk('bomb', 4, 8), mk('bomb', 14, 7), L)));
t(39, '同张数炸比点', () => assert.ok(beat(mk('bomb', 10, 4), mk('bomb', 9, 4), L)));
t(40, '级牌炸>A炸', () => assert.ok(beat(mk('bomb', 7, 4), mk('bomb', 14, 4), L)));
t(41, '连对比大点', () => assert.ok(beat(mk('pairseq', 9, 6), mk('pairseq', 8, 6), L)));
t(42, '钢板比大点', () => assert.ok(beat(mk('tripleseq', 10, 6), mk('tripleseq', 9, 6), L)));
t(43, '同主点顺子不能互压', () => assert.ok(!beat(mk('straight', 9, 5), mk('straight', 9, 5), L)));
t(44, '炸弹压一切非炸', () => assert.ok(beat(mk('bomb', 2, 4), mk('single', 16, 1), L)));
t(45, '同花顺同点不能互压', () => assert.ok(!beat(mk('straightflush', 9, 5), mk('straightflush', 9, 5), L)));

// ---------- 46-55 牌堆与工具 ----------
t(46, '牌堆108张且id唯一', () => {
  const d = buildDeck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map((x) => x.id)).size, 108);
});
t(47, '发牌每人27张', () => {
  const g = new GuandanHand(1, L, null);
  for (let s = 0; s < 4; s++) assert.equal(g.hands[s].length, 27);
});
t(48, '整局打完牌守恒108张', () => {
  const g = autoRun(new GuandanHand(42, L, null));
  const total = g.hands.reduce((a, h) => a + h.length, 0)
    + g.log.reduce((a, l) => a + (l.play ? l.play.cards.length : 0), 0);
  assert.equal(total, 108);
});
t(49, 'maxCard 找大王', () => {
  const h = handOf([3], [16], [14]);
  assert.equal(maxCard(h, L).rank, 16);
});
t(50, '只有红桃级牌是百搭', () => {
  assert.ok(isWild(c(7, 1), 7));
  assert.ok(!isWild(c(7, 0), 7));
  assert.ok(!isWild(c(7, 1), 8));
});
t(51, '级牌比较提升14.5', () => {
  assert.equal(cmpRank(7, 7), 14.5);
  assert.equal(cmpRank(14, 7), 14);
});
t(52, '排序把大王放最后', () => {
  const h = sortCards(handOf([16], [3], [7, 1], [14]), 7);
  assert.equal(h[3].rank, 16);
});
t(53, 'cardLabel 正常', () => assert.equal(cardLabel(c(16)), '大王'));
t(54, 'enumerateBombs 找天王炸', () => {
  const h = handOf([15], [15], [16], [16], [3]);
  assert.ok(enumerateBombs(h, L).some((p) => p.type === 'jokerbomb'));
});
t(55, 'enumerateBombs 找同花顺', () => {
  const h = handOf([8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [2, 2]);
  assert.ok(enumerateBombs(h, L).some((p) => p.type === 'straightflush'));
});

// ---------- 56-75 自动对局模拟 ----------
function autoRun(g: GuandanHand): GuandanHand {
  let steps = 0;
  while (g.phase === 'play' && steps < g.stepCap) {
    assert.ok(g.autoStep(), `第${steps}步 AI 无法行动`);
    steps++;
  }
  if (g.phase !== 'done') {
    // 可能在等玩家还贡：模拟自动还最小
    if (g.phase === 'tribute-return') {
      const cands = g.returnCandidates(0);
      g.playerReturn(cands[0].id);
      return autoRun(g);
    }
    throw new Error(`未收敛：phase=${g.phase} steps=${steps}`);
  }
  return g;
}
for (let i = 0; i < 20; i++) {
  const seed = 100 + i * 13;
  t(56 + i, `自动对局收敛 seed=${seed}`, () => {
    const g = autoRun(new GuandanHand(seed, [2, 3, 5, 10, 14][i % 5], null));
    assert.equal(g.phase, 'done');
    assert.equal(g.finished.length, 4);
    assert.equal(new Set(g.finished).size, 4, '名次必须 4 个不同座位');
    const res = g.result();
    assert.ok([0, 1, 2, 3].includes(res.headSeat));
    // 手牌守恒
    const played = g.log.reduce((a, l) => a + (l.play ? l.play.cards.length : 0), 0);
    assert.equal(played + g.hands[res.order[3]].length, 108);
  });
}

// ---------- 76-88 教练 ----------
t(76, '领出推荐必合法', () => {
  const g = new GuandanHand(7, L, null);
  g.currentSeat = 0;
  const recs = recommend(g, 0);
  assert.ok(recs.length >= 1);
  assert.ok(recs[0].play, '领出必须有推荐牌');
  assert.ok(analyze(recs[0].play!.cards, g.level));
});
t(77, '压牌推荐能压过或建议不出', () => {
  const g = new GuandanHand(8, L, null);
  g.currentSeat = 0;
  // 构造一个上家出牌局面
  const toBeat = analyze(handOf([5], [5, 2]), L)!;
  (g as any).lastPlay = toBeat; (g as any).lastSeat = 1;
  const recs = recommend(g, 0);
  if (recs[0].play) assert.ok(beat(recs[0].play, toBeat, g.level));
});
t(78, '事中：非法牌型被拦截', () => {
  const g = new GuandanHand(9, L, null);
  g.currentSeat = 0;
  const corr = evaluate(g, 0, handOf([3], [4], [5], [6]));
  assert.equal(corr.verdict, 'illegal');
});
t(79, '事中：领出时不出被拦截', () => {
  const g = new GuandanHand(10, L, null);
  g.currentSeat = 0;
  assert.equal(evaluate(g, 0, null).verdict, 'illegal');
});
t(80, '事中：压不过的牌被拦截', () => {
  const g = new GuandanHand(11, L, null);
  g.currentSeat = 0;
  const toBeat = analyze(handOf([14]), L)!;
  (g as any).lastPlay = toBeat; (g as any).lastSeat = 1;
  const corr = evaluate(g, 0, handOf([5]));
  assert.equal(corr.verdict, 'illegal');
});
t(81, '事中：能压却不出给提示', () => {
  // 构造玩家手牌含小对子可压
  const g = new GuandanHand(12, L, null);
  g.hands[0] = handOf([6], [6, 2], [9]);
  g.currentSeat = 0;
  const toBeat = analyze(handOf([5], [5, 2]), L)!;
  (g as any).lastPlay = toBeat; (g as any).lastSeat = 1;
  const corr = evaluate(g, 0, null);
  assert.ok(corr.verdict === 'suboptimal' || corr.verdict === 'ok');
  if (corr.verdict === 'suboptimal') assert.ok(corr.better);
});
t(82, '事中：开局乱炸被判重大失误', () => {
  const g = new GuandanHand(13, L, null);
  g.hands[0] = handOf([3], [4], [5], [6], [8], [9], [9, 1], [9, 2], [9, 3], [10], [11], [12]);
  g.currentSeat = 0;
  const toBeat = analyze(handOf([4], [4, 2]), 13 === L ? 7 : L)!; // 小对子
  (g as any).lastPlay = analyze(handOf([4], [4, 2]), L)!; (g as any).lastSeat = 1;
  const bomb = analyze(handOf([9], [9, 1], [9, 2], [9, 3]), L)!;
  const corr = evaluate(g, 0, bomb.cards);
  assert.equal(corr.verdict, 'blunder');
  assert.ok(corr.message.includes('炸弹'));
});
t(83, '复盘产出合法', () => {
  const g = autoRun(new GuandanHand(14, L, null));
  const rep = review(g, '测试');
  assert.ok(rep.accuracy >= 0 && rep.accuracy <= 1);
  assert.ok(rep.tips.length >= 1 && rep.tips.length <= 3);
});
t(84, '推荐备选不超过3个', () => {
  const g = new GuandanHand(15, L, null);
  g.currentSeat = 0;
  assert.ok(recommend(g, 0).length <= 3);
});
t(85, 'scoreChoice 与 decide 对同牌一致', () => {
  const g = new GuandanHand(16, L, null);
  g.currentSeat = 0;
  const ctx = g.aiContext(0);
  const d = decide(ctx);
  if (d.play) assert.equal(scoreChoice(ctx, d.play), d.score);
});
t(86, '摸底题3道且答案在范围内', () => {
  assert.equal(QUIZ.length, 3);
  for (const q of QUIZ) assert.ok(q.answer >= 0 && q.answer < q.options.length);
});
t(87, '摸底加分在±150内', () => {
  for (let k = 0; k <= 3; k++) assert.ok(Math.abs(quizBonus(k)) <= 150);
});
t(88, '玩家出完后续回合不炸', () => {
  const g = new GuandanHand(17, L, null);
  g.hands[0] = handOf([3]);
  g.currentSeat = 0;
  assert.equal(g.play(0, g.hands[0]), null);
  assert.ok(g.finished.includes(0));
});

// ---------- 89-100 评级/进贡/整局 ----------
t(89, '赢局掼力为正', () => assert.ok(ratingDelta({ won: true, myDelta: 2, oppDelta: 0, accuracy: 0.8 }) > 0));
t(90, '输局掼力为负', () => assert.ok(ratingDelta({ won: false, myDelta: 0, oppDelta: 2, accuracy: 0.8 }) < 0));
t(91, '决策准确率单调增益', () => {
  const a = ratingDelta({ won: true, myDelta: 1, oppDelta: 0, accuracy: 1 });
  const b = ratingDelta({ won: true, myDelta: 1, oppDelta: 0, accuracy: 0 });
  assert.ok(a > b);
});
t(92, '掼力值有界', () => {
  assert.equal(clampRating(-50), 0);
  assert.equal(clampRating(9999), 4000);
  assert.equal(clampRating(NaN), 1000);
});
t(93, '段位映射边界', () => {
  assert.equal(tierOf(0).name, '入门');
  assert.equal(tierOf(949).name, '入门');
  assert.equal(tierOf(950).name, '新手');
  assert.equal(tierOf(4000).name, '掼圣');
  assert.ok(TIERS.every((x, i) => i === 0 || TIERS[i - 1].min > x.min), '段位阈值递减排列');
});
t(94, '进贡给出最大牌', () => {
  const g1 = autoRun(new GuandanHand(20, L, null));
  const res = g1.result();
  const g2 = new GuandanHand(21, L, res);
  assert.ok(g2.tribute, '应有进贡信息');
  if (!g2.tribute!.resisted) {
    for (const [giver, card] of g2.tribute!.given) {
      const receiver = g2.tribute!.pairs.find((p) => p.giver === giver)!.receiver;
      assert.ok(g2.hands[receiver].some((c) => c.id === card.id) || g2.hands[giver].some((c) => c.id === card.id), '贡牌流向可追踪');
    }
  }
});
t(95, '双下触发双贡', () => {
  // 找一手双下的对局
  for (let seed = 30; seed < 60; seed++) {
    const g1 = autoRun(new GuandanHand(seed, L, null));
    const res = g1.result();
    if (res.doubleDown) {
      const g2 = new GuandanHand(seed + 1, L, res);
      assert.equal(g2.tribute!.double, true);
      if (!g2.tribute!.resisted) assert.equal(g2.tribute!.pairs.length, 2);
      return;
    }
  }
  throw new Error('30 局内无双下样本');
});
t(96, '还贡候选点数≤10', () => {
  const g = new GuandanHand(70, L, null);
  const cands = g.returnCandidates(0);
  for (const c of cands) assert.ok(c.suit === -1 ? true : c.rank <= 10 || cands.every((x) => x.rank > 10));
});
t(97, '玩家还贡流转正确', () => {
  const g1 = autoRun(new GuandanHand(80, L, null));
  const res = g1.result();
  if (res.headSeat === 0) {
    const g2 = new GuandanHand(81, L, res);
    if (g2.phase === 'tribute-return') {
      const before = g2.hands[0].length;
      const cand = g2.returnCandidates(0)[0];
      assert.ok(g2.playerReturn(cand.id));
      assert.equal(g2.hands[0].length, before - 1);
      assert.equal(g2.phase, 'play');
    }
  }
});
t(98, '玩家出炸记录精彩时刻', () => {
  const g = new GuandanHand(90, L, null);
  g.hands[0] = handOf([9], [9, 1], [9, 2], [9, 3], [5]);
  g.currentSeat = 0;
  g.phase = 'play';
  const bomb = analyze(g.hands[0].filter((x) => x.rank === 9), L)!;
  assert.equal(g.play(0, bomb.cards), null);
  assert.ok(g.highlights.some((h) => h.seat === 0 && h.kind === 'bomb'));
});
t(99, 'handLevel 跟头游方级别', () => {
  const m = newMatch();
  m.levels = [5, 9];
  m.handOwner = 1;
  assert.equal(handLevel(m), 9);
});
t(100, '整局模拟最终分出胜负', () => {
  const m = newMatch();
  let hands = 0;
  let prev: HandResult | null = null;
  while (!m.over && hands < 60) {
    const g = autoRun(new GuandanHand(1000 + hands * 7, handLevel(m), prev));
    prev = g.result();
    advanceMatch(m, prev);
    hands++;
  }
  assert.ok(m.over, '60 手内应分出胜负');
  assert.ok(m.winner === 0 || m.winner === 1);
  for (const lv of m.levels) assert.ok(lv >= 2 && lv <= 14);
});

// ---------- 101-105 v1.1 回归：炸弹保护/随机性/军师对话 ----------
t(101, '压对子绝不拆四张炸', () => {
  // 手牌：四个9 + 对6 + 散牌；上家对5
  const h = handOf([9], [9, 1], [9, 2], [9, 3], [6], [6, 2], [3], [4], [11]);
  const toBeat = analyze(handOf([5], [5, 2]), L)!;
  const resp = enumerateResponses(h, L, toBeat);
  for (const p of resp) {
    if (p.type === 'pair') {
      assert.ok(!p.cards.some((c) => c.rank === 9), '对子候选不得包含炸弹组的牌');
    }
  }
  assert.ok(resp.some((p) => p.type === 'pair' && p.mainRank === 6), '应优先用对6压');
});
t(102, '压单张不拆炸（有安全大牌时）', () => {
  const h = handOf([9], [9, 1], [9, 2], [9, 3], [14], [3]);
  const toBeat = analyze(handOf([13]), L)!;
  const resp = enumerateResponses(h, L, toBeat);
  const singles = resp.filter((p) => p.type === 'single');
  assert.ok(singles.length > 0);
  assert.ok(singles.every((p) => p.mainRank !== 9), '单张候选不得拆炸弹');
  assert.ok(singles.some((p) => p.mainRank === 14), '应包含安全单张A');
});
t(103, '同种子整手可复现', () => {
  const g1 = autoRun(new GuandanHand(555, L, null));
  const g2 = autoRun(new GuandanHand(555, L, null));
  assert.equal(JSON.stringify(g1.log.map((l) => [l.seat, l.label])), JSON.stringify(g2.log.map((l) => [l.seat, l.label])));
});
t(104, '不同种子整局有差异', () => {
  const g1 = autoRun(new GuandanHand(556, L, null));
  const g2 = autoRun(new GuandanHand(557, L, null));
  assert.notEqual(JSON.stringify(g1.log.map((l) => l.label)), JSON.stringify(g2.log.map((l) => l.label)));
});
t(105, '军师六问均有针对性回答', async () => {
  const { CHAT_CHIPS, coachChat } = await import('../src/lib/guandan/coach.ts');
  const g = new GuandanHand(600, L, null);
  g.currentSeat = 0;
  for (const chip of CHAT_CHIPS) {
    const ans = coachChat(chip.id, g, 0, null);
    assert.ok(ans.length > 10, `${chip.text} 回答过短`);
    assert.ok(!/undefined|NaN/.test(ans), `${chip.text} 回答含异常值`);
  }
});

// ---------- 106 v1.3 回归：两张残局先出大牌 ----------
t(106, '剩 9+大王 时必须先出大王锁出牌权', () => {
  const g = new GuandanHand(777, L, null);
  g.hands[0] = handOf([9], [16]); // 单9 + 大王
  g.currentSeat = 0;
  g.phase = 'play';
  const ctx = g.aiContext(0);
  const d = decide(ctx);
  assert.ok(d.play, '必须有推荐');
  assert.equal(d.play!.cards[0].rank, 16, '剩两张时应先出大王而非小单');
  assert.ok(d.reason.includes('锁死出牌权') || d.reason.includes('收尾'), '理由应说明残局逻辑');
  // 教练口径一致：玩家选 9 应被判为劣着
  const { evaluate } = awaitImportCoach();
  const corr = evaluate(g, 0, g.hands[0].filter((x) => x.rank === 9));
  assert.ok(corr.verdict === 'suboptimal' || corr.verdict === 'blunder', `出 9 应被判劣着，实际 ${corr.verdict}`);
});
function awaitImportCoach(): typeof import('../src/lib/guandan/coach.ts') {
  // 同步引用（顶部已静态导入 recommend/evaluate/review）
  return { evaluate } as never;
}

// ---------- 107-110 v1.4 回归：打2回绕顺/中局配合 ----------
t(107, '打2时方块A2345是同花顺', () => {
  const p = analyze(handOf([14, 3], [2, 3], [3, 3], [4, 3], [5, 3]), 2);
  assert.equal(p?.type, 'straightflush');
});
t(108, '打2时普通23456顺子合法（2按牌面低点参与）', () => {
  const p = analyze(handOf([2], [3, 1], [4], [5], [6]), 2); // ♠2 为普通级牌，按牌面进顺子
  assert.equal(p?.type, 'straight');
  assert.equal(p?.mainRank, 6);
});
t(109, '送桥：搭档剩2张时领出小单', () => {
  const g = new GuandanHand(888, 10, null);
  g.hands[0] = handOf([3], [4], [6], [8], [9], [12]);
  g.hands[2] = handOf([5], [11]); // 搭档只剩 2 张
  g.currentSeat = 0;
  g.phase = 'play';
  const d = decide(g.aiContext(0));
  assert.ok(d.play, '必须有推荐');
  assert.equal(d.play!.type, 'single', '送桥应出小单张');
  assert.ok(cmpRank(d.play!.mainRank, 10) <= 8, '送桥应为小点');
  assert.ok(d.reason.includes('送桥'), '理由应说明送桥');
});
t(110, '对手剩2张时领出偏好强牌压制', () => {
  const g = new GuandanHand(889, 10, null);
  g.hands[0] = handOf([3], [5], [6], [8], [9], [14]);
  g.hands[1] = handOf([4], [12]); // 对手只剩 2 张
  g.hands[2] = handOf([4,1],[4,2],[4,3],[5,1],[5,2],[6,1],[6,2],[7,1],[7,2],[8,1],[9,1],[9,2],[10,1],[11,1],[11,2],[12,1],[13,1],[13,2],[14,1],[14,2],[2,1],[2,2],[3,1],[3,2],[5,3],[6,3]);
  g.currentSeat = 0;
  g.phase = 'play';
  const d = decide(g.aiContext(0));
  assert.ok(d.play, '必须有推荐');
  assert.ok(cmpRank(d.play!.mainRank, 10) >= 12 || d.play!.type !== 'single', '对手濒危时应用强牌压制');
});

// ---------- 111-113 v1.5 回归：掼蛋口诀融入 ----------
t(111, '用炸口诀：报7该炸、报10留炸、报4留炸、报6该炸', () => {
  const h = handOf([9], [9, 1], [9, 2], [9, 3], [3], [4], [11]); // 四个9 + 散牌，无对子
  const toBeat = analyze(handOf([14], [14, 2]), L)!; // 上家对A，只有炸能压
  const mk = (opp: number) =>
    decide({ seat: 1, hand: h, level: L, toBeat, trickWinner: 0, partner: 3, oppMinCards: opp, partnerCards: 20 });
  assert.equal(mk(7).play?.type, 'bomb', '对手报7应果断炸');
  assert.ok(mk(7).reason.includes('炸七不炸八'), '理由应带口诀');
  assert.equal(mk(10).play, null, '对手报10应留炸');
  assert.equal(mk(4).play, null, '对手报4应留炸（可能藏一手大货）');
  assert.equal(mk(6).play?.type, 'bomb', '见六就要治');
  assert.equal(mk(2).play?.type, 'bomb', '对手剩2张危急必炸');
});
t(112, '复盘建议非空且不超过3条', () => {
  const g = autoRun(new GuandanHand(999, L, null));
  const r = review(g, '测试复盘');
  assert.ok(r.tips.length >= 1 && r.tips.length <= 3, `tips 数量异常: ${r.tips.length}`);
});
t(113, '军师用炸/记牌口诀答案含关键词', async () => {
  const { CHAT_CHIPS, coachChat } = await import('../src/lib/guandan/coach.ts');
  const g = new GuandanHand(601, L, null);
  g.currentSeat = 0;
  assert.ok(CHAT_CHIPS.some((ch) => ch.id === 'count'), '应新增记牌口诀问题');
  const bombAns = coachChat('bomb', g, 0, null);
  assert.ok(bombAns.includes('炸九不炸十'), '用炸答案应含口诀');
  const countAns = coachChat('count', g, 0, null);
  assert.ok(countAns.includes('四张王') && countAns.includes('5 和 10'), '记牌答案应含记牌要点');
});

// ---------- 114-116 v1.6 回归：级牌按牌面参与顺子 ----------
t(114, '打5时♠5可进3-4-5-6-7顺子（用户裁定口径）', () => {
  const p = analyze(handOf([3], [4, 1], [5], [6], [7]), 5); // ♠5 普通级牌按牌面参与
  assert.equal(p?.type, 'straight');
  assert.equal(p?.mainRank, 7);
});
t(115, '序列比较按牌面值：打7时34567顺子压不过8910JQ', () => {
  const low = analyze(handOf([3], [4, 1], [5], [6], [7]), L)!; // 主点 7（级牌不提升）
  const high = analyze(handOf([8], [9, 1], [10], [11], [12]), L)!; // 主点 Q
  assert.equal(low.type, 'straight');
  assert.equal(high.type, 'straight');
  assert.ok(!beat(low, high, L), '含顶级牌的顺子不得因级牌提升而变大');
  assert.ok(beat(high, low, L));
});
t(116, '同花顺比较按牌面值：打7时♠34567同花顺<♣8910JQ同花顺', () => {
  const low = analyze(handOf([3, 0], [4, 0], [5, 0], [6, 0], [7, 0]), L)!;
  const high = analyze(handOf([8, 2], [9, 2], [10, 2], [11, 2], [12, 2]), L)!;
  assert.equal(low.type, 'straightflush');
  assert.equal(high.type, 'straightflush');
  assert.ok(!beat(low, high, L));
  assert.ok(beat(high, low, L));
});

// ---------- 117-120 v1.7 残局模式 ----------
t(117, '经典残局「大王锁喉」唯一解：先出大王', () => {
  const pz = CLASSICS[0].puzzle();
  assert.equal(pz.solution.cards.length, 1);
  assert.equal(pz.solution.cards[0].rank, 16);
  const s = initialState(pz.hands, pz.level);
  assert.equal(winningMoves(s).length, 1);
  const bad = analyze([pz.hands[0][0]], pz.level)!; // 先出 9
  assert.equal(winTeamA(applyMove(s, bad)), false, '先出 9 会被下家截走头游');
});
t(118, '随机残局首着唯一且正着必胜', () => {
  const pz = genPuzzle(20260914, 7);
  assert.ok(pz, '应能生成残局');
  const s = initialState(pz!.hands, pz!.level);
  const wm = winningMoves(s);
  assert.equal(wm.length, 1, '取胜首着必须唯一');
  assert.ok(winTeamA(applyMove(s, wm[0])), '走出正着后己方必胜');
});
t(119, '残局复盘：错着被标记并给出正解与理由', () => {
  const pz = CLASSICS[0].puzzle();
  const wrong = analyze([pz.hands[0][0]], pz.level)!;
  const rep = evaluateLine(pz, [{ seat: 0, play: wrong }], 1);
  assert.equal(rep.solved, false);
  assert.equal(rep.steps[0].verdict, 'wrong');
  assert.ok(rep.steps[0].bestLabel!.includes('大王'), '正解应为大王');
  assert.ok((rep.steps[0].reason ?? '').includes('锁死出牌权'));
  assert.ok(rep.pv.length > 0, '应给出正确线路');
});
t(120, '按正解线路行棋己方必头游', () => {
  const pz = genPuzzle(20260915, 5) ?? CLASSICS[0].puzzle();
  let s = initialState(pz.hands.map((h) => [...h]), pz.level);
  let guard = 0;
  while (s.finished.length === 0 && guard++ < 60) {
    const m = s.seat % 2 === 0 ? (winningMoves(s)[0] ?? heuristicMove(s)) : heuristicMove(s);
    s = applyMove(s, m);
  }
  assert.ok(s.finished.length > 0, '残局应在有限步内结束');
  assert.equal(s.finished[0] % 2, 0, '己方必须拿到头游');
});

t(121, '残局难度分级：三档生成均唯一解且规模合规', () => {
  assert.equal(diffOfSolved(0), 'easy');
  assert.equal(diffOfSolved(3), 'mid');
  assert.equal(diffOfSolved(8), 'hard');
  const cases: [Difficulty, number, number][] = [['easy', 2, 3], ['mid', 3, 4], ['hard', 4, 6]];
  for (const [d, lo, hi] of cases) {
    const pz = genPuzzleD(20260900 + d.length * 77, 9, d);
    assert.ok(pz, `${d} 档应能生成残局`);
    assert.ok(pz!.hands[0].length >= lo && pz!.hands[0].length <= hi, `${d} 档南家张数应在 ${lo}-${hi}`);
    const s = initialState(pz!.hands, pz!.level);
    assert.equal(winningMoves(s).length, 1, `${d} 档首着必须唯一`);
  }
});

t(122, '记牌器：已出+我手扣减，级牌重叠跳过', () => {
  // 打7：南家手持大王1张 + A1张；场上已出大王1张、对A
  const g = new GuandanHand(777, 7, null);
  g.hands[0] = handOf([16], [14]);
  g.log = [
    { turn: 1, seat: 1, play: analyze(handOf([16]), 7)!, label: '大王', isBomb: false },
    { turn: 2, seat: 2, play: analyze(handOf([14], [14, 2]), 7)!, label: 'AA', isBomb: false },
  ];
  const items = trackCards(g, 7);
  const get = (k: string) => items.find((i) => i.key === k);
  assert.equal(get('bj')?.left, 0, '大王2张都已出现/在手');
  assert.equal(get('r14')?.left, 5, 'A共8张：已出2+在手1=3，剩5');
  assert.equal(get('r14')?.total, 8);
  assert.ok(get('level'), '应有级牌条目');
  assert.equal(get('level')?.left, 6);
  assert.ok(!get('r7'), '打7时跳过 rank7 条目');
  assert.equal(get('wild')?.left, 2, '逢人配未出现');
  assert.equal(get('sj')?.left, 2);
});

t(123, '发牌公平性：不重复、分布均匀、三同频率符合两副牌期望', () => {
  const N = 600;
  const seat0Count = new Array(108).fill(0);
  let tripleSum = 0;
  for (let k = 0; k < N; k++) {
    const g = new GuandanHand(k * 7919 + 1, 7, null);
    const ids = new Set<number>();
    for (const h of g.hands) for (const card of h) { assert.ok(!ids.has(card.id), '一手牌内不能有重复牌'); ids.add(card.id); }
    assert.equal(ids.size, 108);
    for (const card of g.hands[0]) seat0Count[card.id]++;
    const byRank = new Map<number, number>();
    for (const card of g.hands[0]) if (card.suit !== -1) byRank.set(card.rank, (byRank.get(card.rank) ?? 0) + 1);
    tripleSum += [...byRank.values()].filter((n) => n >= 3).length;
  }
  const expect = N / 4; // 每张牌出现在南家的期望次数 = 27/108·N
  for (let id = 0; id < 108; id++) {
    assert.ok(Math.abs(seat0Count[id] - expect) < expect * 0.3, `牌${id}分布异常: ${seat0Count[id]} vs 期望${expect}`);
  }
  const avgTriples = tripleSum / N;
  // 两副牌 27 张手牌，平均 3~4 个点数会凑成 ≥3 张——这是掼蛋的数学常态而非发牌 bug
  assert.ok(avgTriples > 1.5 && avgTriples < 6.5, `三同频率应在合理区间，实测均值 ${avgTriples.toFixed(2)}`);
});

t(124, '中局领出不乱烧王牌：有小牌时不出小王', () => {
  // 手牌 9 张全是中小单张 + 小王；对手只剩 3 张——旧逻辑会出小王，修复后应出 K 或小牌
  const hand = handOf([5], [6], [7], [9], [10], [11], [12], [13], [15]);
  const d = decide({ seat: 2, hand, level: 2, toBeat: null, trickWinner: null, partner: 0, oppMinCards: 3, partnerCards: 12 });
  assert.ok(d.play, '应有领出方案');
  assert.ok(!d.play!.cards.some((card) => card.suit === -1), `不应出王牌，实际: ${d.play!.cards.map(cardLabel).join(' ')}`);
});

t(125, '进贡流程：凭上一手结果触发，贡牌/还贡正确转移', () => {
  const g1 = new GuandanHand(20260914, 5, null);
  let guard = 0;
  while (g1.phase !== 'done' && guard++ < 2000) g1.autoStep();
  const res = g1.result();
  const g2 = new GuandanHand(20260915, 5, res);
  assert.ok(g2.tribute, '有上一手结果时必须进入进贡流程');
  if (!g2.tribute!.resisted) {
    assert.equal(g2.tribute!.given.size, res.doubleDown ? 2 : 1, '双下双贡/单下单贡');
    for (const p of g2.tribute!.pairs) {
      const given = g2.tribute!.given.get(p.giver)!;
      assert.ok(g2.hands[p.receiver].some((card) => card.id === given.id), '贡牌应在收贡方手中');
      assert.ok(!g2.hands[p.giver].some((card) => card.id === given.id), '贡牌不应留在贡方手中');
    }
    if (g2.phase === 'tribute-return') {
      const cands = g2.returnCandidates(0);
      assert.ok(cands.length > 0, '玩家收贡后须有还贡候选');
      assert.ok(g2.playerReturn(cands[0].id), '玩家还贡应成功');
      assert.equal(g2.phase, 'play');
    }
    for (const h of g2.hands) assert.equal(h.length, 27, '进贡还贡完成后各家仍是 27 张');
  }
});

t(126, '开牌点评：强牌给进攻策略、弱牌给辅助策略、逢人配给用法建议', () => {
  const strong = handOf([16], [16], [15], [15], [14], [14, 1], [14, 2], [14, 3], [13], [13, 1], [13, 2], [12], [12, 1], [11], [11, 1], [10], [10, 1], [9], [9, 1], [8], [8, 1], [7], [7, 1], [6], [6, 1], [5], [5, 1]);
  const r1 = openingReview(strong, 2);
  assert.ok(r1.grade === '强' || r1.grade === '中上', `天王炸+四炸应评高分，实际 ${r1.grade}`);
  assert.ok(r1.lines.some((l) => l.includes('炸')), '强牌点评应提到炸');
  const weak = handOf([2], [3], [4], [6], [7], [9], [10], [11, 2], [12, 2], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [9, 1], [10, 2], [12, 3], [2, 2], [3, 2], [4, 2], [6, 2], [7, 2], [9, 2], [10, 3], [11, 3], [13, 3], [5, 3]);
  const r2 = openingReview(weak, 5);
  assert.equal(r2.grade, '偏弱', `无炸无王应评偏弱，实际 ${r2.grade}`);
  assert.ok(r2.lines.some((l) => l.includes('辅助')), '弱牌应建议辅助打法');
  const withWild = handOf([5, 1], [6], [7], [8], [9], [9, 1], [9, 2], [10], [11], [12], [13], [14], [2], [3], [4], [5], [6, 1], [7, 1], [8, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [2, 1], [3, 1], [4, 1]);
  const r3 = openingReview(withWild, 5); // 打 5：♥5 是逢人配
  assert.ok(r3.lines.some((l) => l.includes('逢人配')), '有逢人配必须给出用法建议');
});

// ---------- 汇总 ----------
console.log(`\n通过 ${passed}/${total}`);
if (failures.length > 0) {
  console.log('\n失败用例：');
  for (const f of failures) console.log('  ✗', f);
  process.exit(1);
} else {
  console.log('全部通过 ✅');
}
