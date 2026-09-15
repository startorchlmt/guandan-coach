/**
 * 掼蛋军师 · 教练系统：事前指导 / 事中纠正 / 事后复盘 / 摸底测验
 */
import { cardsLabel, isWild } from './cards.ts';
import type { Card } from './cards.ts';
import { analyze, beat, TYPE_NAMES, isBombType } from './patterns.ts';
import type { Play } from './patterns.ts';
import { decide, scoreChoice, enumerateLeads, enumerateResponses, enumerateBombs, analyzeHand, breaksBombStructure } from './ai.ts';
import type { AiContext } from './ai.ts';
import type { GuandanHand, Highlight } from './game.ts';

export interface Recommendation {
  play: Play | null;
  label: string; // 牌面或「不出」
  reason: string;
  score: number;
}

/** 事前指导：给出 1 个主推 + 最多 2 个备选 */
export function recommend(hand: GuandanHand, seat: number): Recommendation[] {
  const ctx = hand.aiContext(seat);
  const top = decide(ctx);
  const out: Recommendation[] = [{
    play: top.play,
    label: top.play ? cardsLabel(top.play.cards) : '不出',
    reason: top.reason,
    score: top.score,
  }];
  // 备选：从枚举中挑与主推不同的次优合法解
  if (top.play) {
    const alts = ctx.toBeat === null
      ? enumerateLeads(ctx.hand, ctx.level)
      : enumerateResponses(ctx.hand, ctx.level, ctx.toBeat);
    for (const p of alts) {
      if (out.length >= 3) break;
      if (top.play && sameCards(p, top.play)) continue;
      out.push({ play: p, label: cardsLabel(p.cards), reason: `备选：${TYPE_NAMES[p.type]}，${cardsLabel(p.cards)}`, score: scoreChoice(ctx, p) });
    }
  }
  return out;
}

function sameCards(a: Play, b: Play): boolean {
  const ka = a.cards.map((c) => c.id).sort().join(',');
  const kb = b.cards.map((c) => c.id).sort().join(',');
  return ka === kb;
}

export type Verdict = 'illegal' | 'good' | 'ok' | 'suboptimal' | 'blunder';

export interface Correction {
  verdict: Verdict;
  message: string;
  better?: Recommendation; // 更优方案（可供一键改出）
}

/**
 * 事中纠正：玩家选定牌后、确认前调用。
 * cards=null 表示选择「不出」。
 */
export function evaluate(hand: GuandanHand, seat: number, cards: Card[] | null): Correction {
  const ctx: AiContext = hand.aiContext(seat);
  const top = decide(ctx);

  if (cards === null || cards.length === 0) {
    if (ctx.toBeat === null) return { verdict: 'illegal', message: '轮到你领出，不能不出' };
    if (top.play === null) return { verdict: 'good', message: '判断正确：此轮不值得跟，保留实力。' };
    if (isBombType(top.play.type)) {
      return { verdict: 'ok', message: `可以不出。不过你有${TYPE_NAMES[top.play.type]}能压，视局势而定。`, better: { play: top.play, label: cardsLabel(top.play.cards), reason: top.reason, score: top.score } };
    }
    return {
      verdict: 'suboptimal',
      message: `你有牌能压过（如 ${cardsLabel(top.play.cards)}），放过这轮可能丢掉出牌权。`,
      better: { play: top.play, label: cardsLabel(top.play.cards), reason: top.reason, score: top.score },
    };
  }

  const play = analyze(cards, ctx.level);
  if (!play) {
    return { verdict: 'illegal', message: '这不是合法牌型。支持：单张/对子/三同/三带二/顺子(5张)/连对(3对)/钢板(2个三同)/炸弹/同花顺/天王炸。' };
  }
  if (ctx.toBeat && !beat(play, ctx.toBeat, ctx.level)) {
    return { verdict: 'illegal', message: `${TYPE_NAMES[play.type]}压不过上家的${TYPE_NAMES[ctx.toBeat.type]}（${cardsLabel(ctx.toBeat.cards)}）。` };
  }

  const myScore = scoreChoice(ctx, play);
  const topScore = top.play ? top.score : 0;
  const gap = topScore - myScore;

  if (top.play && sameCards(play, top.play)) {
    return { verdict: 'good', message: '与教练推荐一致，好棋！' };
  }
  if (gap <= 0.5) return { verdict: 'good', message: '不错的选择，与推荐方案价值相当。' };
  // 拆炸预警：拆散炸弹/同花顺结构的选择，给出明确警告
  if (breaksBombStructure(play, ctx.hand, ctx.level)) {
    return {
      verdict: gap > 6 ? 'blunder' : 'suboptimal',
      message: `⚠️ 这手会拆散你手里的炸弹/同花顺结构，太亏了！${top.play ? `建议改为 ${cardsLabel(top.play.cards)}——${top.reason}` : '这轮不出更好。'}`,
      better: top.play ? { play: top.play, label: cardsLabel(top.play.cards), reason: top.reason, score: top.score } : undefined,
    };
  }
  if (gap <= 2.5) {
    return { verdict: 'ok', message: `可行，但略亏。${top.play ? `推荐：${cardsLabel(top.play.cards)}（${top.reason}）` : ''}` };
  }
  if (isBombType(play.type) && (!top.play || !isBombType(top.play.type))) {
    return {
      verdict: 'blunder',
      message: `慎用炸弹！这手${TYPE_NAMES[play.type]}能压，但现在交炸太亏——${top.play ? `用 ${cardsLabel(top.play.cards)} 就够了` : '这轮不值得'}。炸弹要留给关键时刻。`,
      better: top.play ? { play: top.play, label: cardsLabel(top.play.cards), reason: top.reason, score: top.score } : undefined,
    };
  }
  return {
    verdict: gap > 6 ? 'blunder' : 'suboptimal',
    message: gap > 6
      ? `这手明显亏：${playReason(play)}。${top.play ? `建议改为 ${cardsLabel(top.play.cards)}——${top.reason}` : '建议不出。'}`
      : `这手稍弱。${top.play ? `更优：${cardsLabel(top.play.cards)}（${top.reason}）` : '可以考虑不出。'}`,
    better: top.play ? { play: top.play, label: cardsLabel(top.play.cards), reason: top.reason, score: top.score } : undefined,
  };
}

function playReason(p: Play): string {
  if (isBombType(p.type)) return '过早动用炸弹';
  if (p.type === 'single') return '单张效率低，拆散手牌结构';
  return `${TYPE_NAMES[p.type]}此时出收益不高`;
}

// ---------- 事后复盘 ----------

export interface ReviewReport {
  resultText: string;
  accuracy: number; // 决策准确率 0-1
  mistakes: { turn: number; text: string }[];
  highlights: Highlight[];
  tips: string[];
}

export function review(hand: GuandanHand, resultText: string): ReviewReport {
  const playerTurns = hand.log.filter((l) => l.seat === 0 && l.verdict);
  const good = playerTurns.filter((l) => l.verdict === 'good' || l.verdict === 'ok').length;
  const accuracy = playerTurns.length > 0 ? good / playerTurns.length : 1;

  const mistakes = hand.log
    .filter((l) => l.seat === 0 && (l.verdict === 'suboptimal' || l.verdict === 'blunder'))
    .slice(0, 5)
    .map((l) => ({
      turn: l.turn,
      text: `第${l.turn}手出了 ${l.label}${l.verdict === 'blunder' ? '（重大失误）' : '（小亏）'}`,
    }));

  const tips: string[] = [];
  const bombWaste = hand.log.some((l) => l.seat === 0 && l.isBomb && l.verdict === 'blunder');
  if (accuracy < 0.5) tips.push('出牌前先看教练主推方案，理解「为什么」再决定。');
  if (bombWaste) tips.push('炸弹是战略资源，记住口诀：炸九不炸十、炸七不炸八、炸五不炸四、见六就要治。');
  if (hand.log.filter((l) => l.seat === 0 && l.play === null).length > playerTurns.length * 0.6) {
    tips.push('本轮 pass 偏多——有机会用小牌接回出牌权时，值得出手。');
  }
  tips.push('记牌要点：四王、级牌与逢人配、A/K，还有 5 和 10（顺子的关键张）。');
  tips.push('留意搭档信号：搭档控场时学会"让"，搭档困难时果断"接"。');
  while (tips.length > 3) tips.pop();

  const highlights = [...hand.highlights].filter((h) => h.seat === 0).sort((a, b) => b.weight - a.weight).slice(0, 3);

  return { resultText, accuracy, mistakes, highlights, tips };
}

// ---------- 摸底测验 ----------

export interface QuizItem {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

export const QUIZ: QuizItem[] = [
  {
    question: '打 2 时，♥2 是「逢人配」。下面哪组是合法牌型？',
    options: ['♠5 ♥5 ♣5 ♦5 ♥2（5 张炸）', '♠3 ♥4 ♣5 ♦6 ♥2（顺子 3-7）', '以上都对'],
    answer: 2,
    explain: '逢人配可替代除王外任意牌：既能补成 5 张炸，也能补成顺子。',
  },
  {
    question: '打 5 时，单张 ♠5 和单张 ♠A，谁大？',
    options: ['♠A 大', '♠5 大（级牌大于 A）', '一样大'],
    answer: 1,
    explain: '级牌大于 A、小于小王，是本手牌的「准王牌」。',
  },
  {
    question: '上家（对手）出小单张，搭档本轮已经压过且最大，你手中有小单可接。最佳做法是？',
    options: ['马上压过，争夺出牌权', '不出，让搭档继续控场', '直接扔炸弹立威'],
    answer: 1,
    explain: '搭档已控场时跟进是浪费自己的牌；掼蛋是双人配合游戏。',
  },
];

export function quizBonus(correctCount: number): number {
  return (correctCount - 1) * 75; // 0 题 -75，1 题 0，2 题 +75，3 题 +150 → 控制在 ±150
}

// ---------- 军师多轮对话 ----------

export interface ChatMsg {
  from: 'player' | 'coach';
  text: string;
}

export interface ChatChip {
  id: string;
  text: string;
}

/** 对话快捷问题（点选后军师结合当前牌局数据作答，可多轮追问） */
export const CHAT_CHIPS: ChatChip[] = [
  { id: 'why', text: '为什么推荐这样出？' },
  { id: 'disagree', text: '我想坚持自己的打法，风险在哪？' },
  { id: 'bomb', text: '炸弹到底该什么时候用？' },
  { id: 'count', text: '记牌有什么口诀？' },
  { id: 'situation', text: '帮我分析一下当前局势' },
  { id: 'level', text: '级牌和逢人配怎么用最好？' },
  { id: 'partner', text: '怎么和搭档配合？' },
];

export function coachChat(
  chipId: string,
  hand: GuandanHand,
  seat: number,
  corr?: Correction | null,
): string {
  const ctx = hand.aiContext(seat);
  const myBombs = enumerateBombs(ctx.hand, ctx.level);
  const wildCount = ctx.hand.filter((c) => isWild(c, ctx.level)).length;
  const partnerLeft = hand.hands[(seat + 2) % 4].length;
  const oppLeft = ctx.oppMinCards;
  const top = decide(ctx);
  const levelLabel = ctx.level === 14 ? 'A' : String(ctx.level);

  switch (chipId) {
    case 'why':
      return top.play
        ? `推荐「${cardsLabel(top.play.cards)}」的理由：${top.reason}。你手上还有 ${myBombs.length} 个炸${wildCount ? `、${wildCount} 张逢人配` : ''}，这一手的核心是——${top.reason}。`
        : `这轮我建议不出：${top.reason}。留着牌力等更关键的回合。`;
    case 'disagree':
      if (corr && corr.verdict !== 'good') {
        return `坚持也可以，输赢自担 🙂 具体风险：${corr.message} 如果你执意这样出，下轮回合要主动把出牌权抢回来，别让对手连走两手。`;
      }
      return `你的选择和推荐价值相当，可以按自己的节奏打。记住原则：手牌结构别拆散，炸弹别轻易动。`;
    case 'bomb': {
      const verdict = oppLeft <= 3
        ? `对手只剩 ${oppLeft} 张，随时可能走——见机会就炸，别犹豫！`
        : oppLeft === 4
          ? '口诀「炸五不炸四」：报 4 张常藏着同花顺甚至炸弹一把走，炸了也拦不死，先忍住'
          : oppLeft === 9 || oppLeft === 7 || oppLeft === 6 || oppLeft === 5
            ? `口诀「${oppLeft === 9 ? '炸九不炸十' : oppLeft === 7 ? '炸七不炸八' : oppLeft === 5 ? '炸五不炸四' : '见六就要治'}」——对手报 ${oppLeft} 张正是用炸窗口，该炸就炸`
            : oppLeft === 10 || oppLeft === 8
              ? `口诀「${oppLeft === 10 ? '炸九不炸十' : '炸七不炸八'}」：报 ${oppLeft} 张时炸多半拦不死，留炸等更好的时机`
              : '对手牌数还多，留炸备用';
      return `你现在有 ${myBombs.length} 个炸。用炸口诀：炸九不炸十、炸七不炸八、炸五不炸四、见六就要治。当前：${verdict}。再记住两点：大炸留关键局、小炸可探路逼对手大炸；搭档剩 ${partnerLeft} 张，${partnerLeft <= 5 ? '他快走了，必要时用炸给他开道' : '暂时不用替他挡'}。`;
    }
    case 'count':
      return `记牌优先级：①四张王——顶端压制力的归属；②级牌 ${levelLabel} 和逢人配的去向（决定对手能凑出几个炸）；③A 和 K——大牌控制力；④5 和 10——顺子、连对的骨架，断了它们对手难组长牌。先记这几样，胜过面面俱到。`;
    case 'situation':
      return `当前打 ${levelLabel}。你 ${ctx.hand.length} 张、搭档 ${partnerLeft} 张、对手最少 ${oppLeft} 张。你手上有 ${myBombs.length} 个炸、${wildCount} 张逢人配。${ctx.toBeat ? `本轮要压的是${TYPE_NAMES[ctx.toBeat.type]}。` : '本轮你领出。'}${oppLeft <= 5 ? '⚠️ 对手快出完了，优先压制！' : partnerLeft <= 3 ? '搭档即将出完，注意给他接风。' : '局势平稳，按计划走牌。'}`;
    case 'level':
      return `级牌 ${levelLabel} 大于 A 小于王，单出、成对都很硬；但它也能按牌面点数参与顺子——比如打 ${levelLabel} 时，♠${levelLabel} 照样能放进 3-4-5-6-7 这类顺子里（序列比大小只看牌面）。红桃${levelLabel}是逢人配，能补成顺子、炸弹、同花顺——别随手单出浪费，留着补结构最值。你手上有 ${wildCount} 张逢人配。`;
    case 'partner':
      return `配合口诀：搭档控场让一让，搭档困难接一接；搭档剩 ${partnerLeft} 张，${partnerLeft <= 5 ? '他快走了，别压他的牌，必要时用炸护送' : '目前不需要你替他挡'}。`;
    default:
      return '这个问题超出我的教案了，换个问题试试？';
  }
}

// ---------- 开牌点评（初始理牌建议） ----------

export interface OpeningReview {
  power: number; // 牌力分
  grade: '强' | '中上' | '中等' | '偏弱';
  lines: string[];
}

/** 发牌（含进贡）完成后，对这手牌的结构、火力与打法给出点评 */
export function openingReview(hand: Card[], level: number): OpeningReview {
  const hs = analyzeHand(hand, level);
  const bombs = enumerateBombs(hand, level);
  const bigJ = hs.jokers.filter((j) => j.rank === 16).length;
  const smallJ = hs.jokers.filter((j) => j.rank === 15).length;
  const wildN = hs.wilds.length;
  const levelN = (hs.byRank.get(level) ?? []).length;

  let power = bigJ * 3 + smallJ * 1.5 + wildN * 2 + levelN * 1;
  for (const b of bombs) {
    power += b.type === 'jokerbomb' ? 8 : b.type === 'straightflush' ? 5 : b.length >= 6 ? 5 : b.length === 5 ? 4 : 2.5;
  }
  const looseSingles = [...hs.byRank.entries()].filter(([r, cs]) => cs.length === 1 && r <= 10).length;
  power -= looseSingles * 0.4;

  const grade: OpeningReview['grade'] = power >= 14 ? '强' : power >= 9 ? '中上' : power >= 5 ? '中等' : '偏弱';

  const lines: string[] = [];
  const parts: string[] = [];
  if (bombs.length > 0) parts.push(`${bombs.length} 个炸（${[...new Set(bombs.map((b) => TYPE_NAMES[b.type]))].slice(0, 3).join('、')}）`);
  if (bigJ + smallJ > 0) parts.push(`王 ${bigJ + smallJ} 张`);
  if (wildN > 0) parts.push(`逢人配 ${wildN} 张`);
  if (levelN > 0) parts.push(`级牌 ${levelN} 张`);
  lines.push(`牌型盘点：${parts.length > 0 ? parts.join('，') : '无炸无王，牌面清淡'}。`);
  if (looseSingles >= 4) lines.push(`小单张偏多（${looseSingles} 张）：前期优先走单探路，别把小牌憋在手里。`);

  if (wildN > 0) {
    const sf = bombs.find((b) => b.type === 'straightflush' && b.cards.some((c) => isWild(c, level)));
    const wb = bombs.find((b) => b.type === 'bomb' && b.cards.some((c) => isWild(c, level)));
    if (sf) lines.push(`逢人配建议补同花顺（${cardsLabel(sf.cards)}），性价比最高。`);
    else if (wb) lines.push(`逢人配建议补炸（${cardsLabel(wb.cards)}），千万别随手单出浪费。`);
    else lines.push('逢人配先别动，留到中局看哪缺补哪（顺子、钢板、三带二都行）。');
  }

  if (grade === '强') lines.push('总策略：牌力强，主动争夺头游，领出掌握节奏，炸弹护住关键轮次。');
  else if (grade === '中上') lines.push('总策略：稳中带攻，优先走结构牌（顺子/连对），炸弹留给对手报牌时。');
  else if (grade === '中等') lines.push('总策略：跟牌为主，保住手牌结构别硬抢，留意搭档信号再发力。');
  else lines.push('总策略：牌力偏弱，主打辅助——清小牌、给搭档送桥，头游交给搭档去争。');

  const d = decide({ seat: 0, hand, level, toBeat: null, trickWinner: null, partner: 2, oppMinCards: 27, partnerCards: 27 });
  if (d.play) lines.push(`若由你领出，建议先出：${cardsLabel(d.play.cards)}（${d.reason}）。`);

  return { power, grade, lines };
}
