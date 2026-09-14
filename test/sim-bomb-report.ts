/**
 * 实战验证：跑 5 场完整比赛（每场多手牌，直到一方打穿 A），
 * 监控每个「只有炸弹能压」的决策点，验证用炸口诀在实战中的执行：
 *   报 9/7/6/5 → 必须炸；报 10/8/4 → 只能因「残局收尾」或「以炸还炸」而炸，否则必须留炸。
 * 运行：node test/sim-bomb-report.ts
 */
import assert from 'node:assert/strict';
import { GuandanHand, newMatch, advanceMatch, handLevel } from '../src/lib/guandan/game.ts';
import type { HandResult } from '../src/lib/guandan/game.ts';
import { decide, enumerateResponses } from '../src/lib/guandan/ai.ts';
import { isBombType, TYPE_NAMES } from '../src/lib/guandan/patterns.ts';

interface BombDecision {
  match: number;
  seat: number;
  opp: number;
  toBeatType: string;
  bombed: boolean;
  reason: string;
}

const decisions: BombDecision[] = [];

class MonitoredHand extends GuandanHand {
  matchId = 0;
  override autoStep(): boolean {
    if (this.phase === 'play') {
      const seat = this.currentSeat;
      const ctx = this.aiContext(seat);
      if (ctx.toBeat) {
        const resp = enumerateResponses(ctx.hand, ctx.level, ctx.toBeat);
        const nonBombs = resp.filter((p) => !isBombType(p.type));
        if (resp.length > 0 && nonBombs.length === 0) {
          const d = decide(ctx);
          const finishNow = d.play !== null && d.play.cards.length === ctx.hand.length;
          if (!finishNow) {
            decisions.push({
              match: this.matchId, seat, opp: ctx.oppMinCards,
              toBeatType: TYPE_NAMES[ctx.toBeat.type], bombed: d.play !== null, reason: d.reason,
            });
          }
        }
      }
    }
    return super.autoStep();
  }
}

function runHand(g: MonitoredHand): void {
  let steps = 0;
  while (g.phase === 'play' && steps < g.stepCap) {
    if (!g.autoStep()) throw new Error(`AI 无法行动 step=${steps}`);
    steps++;
  }
  if (g.phase === 'tribute-return') {
    const cands = g.returnCandidates(0);
    g.playerReturn(cands[0].id);
    runHand(g);
    return;
  }
  if (g.phase !== 'done') throw new Error(`未收敛 phase=${g.phase}`);
}

// ---------- 跑 5 场完整比赛 ----------
let totalHands = 0;
const matchResults: string[] = [];
for (let m = 0; m < 5; m++) {
  const match = newMatch();
  let prev: HandResult | null = null;
  let hands = 0;
  while (!match.over && hands < 60) {
    const g = new MonitoredHand(20260 + m * 1009 + hands * 17, handLevel(match), prev);
    g.matchId = m + 1;
    runHand(g);
    prev = g.result();
    advanceMatch(match, prev);
    hands++;
  }
  assert.ok(match.over, `第 ${m + 1} 场 60 手内应分出胜负`);
  totalHands += hands;
  matchResults.push(`第${m + 1}场：${hands} 手，${match.winner === 0 ? '我方' : '对方'}胜（级牌 ${match.levels[0]}:${match.levels[1]}）`);
}

// ---------- 口诀合规性校验 ----------
// 合理例外：①搭档已控场时不炸（让搭档走，不浪费火力）；②残局收尾；③对手动炸必须以炸还炸
const urgent = new Set([9, 7, 6, 5]);
const hold = new Set([10, 8, 4]);
let urgentBombed = 0, urgentTotal = 0, urgentPartnerSkip = 0;
let holdBombed = 0, holdTotal = 0;
let critBombed = 0, critTotal = 0, calmBombed = 0, calmTotal = 0;
const violations: string[] = [];

for (const d of decisions) {
  if (urgent.has(d.opp)) {
    urgentTotal++;
    if (d.bombed) urgentBombed++;
    else if (d.reason.includes('搭档已控制')) urgentPartnerSkip++;
    else violations.push(`报 ${d.opp} 张未炸（${d.reason}）`);
  } else if (hold.has(d.opp)) {
    holdTotal++;
    if (d.bombed) {
      holdBombed++;
      const justified = d.reason.includes('收尾') || d.reason.includes('以炸还炸');
      if (!justified) violations.push(`报 ${d.opp} 张误炸（${d.reason}）`);
    }
  } else if (d.opp <= 3) {
    critTotal++;
    if (d.bombed) critBombed++;
    else if (!d.reason.includes('搭档已控制')) violations.push(`对手仅剩 ${d.opp} 张未拦（${d.reason}）`);
  } else {
    calmTotal++;
    if (d.bombed) calmBombed++;
  }
}

console.log(`\n=== 实战验证报告：5 场比赛 / ${totalHands} 手牌 ===`);
for (const r of matchResults) console.log(' ', r);
console.log(`\n「只有炸弹能压」决策点共 ${decisions.length} 次：`);
console.log(`  口诀该炸（报9/7/6/5）：炸 ${urgentBombed} / ${urgentTotal}（其中 ${urgentPartnerSkip} 次因搭档已控场合理让牌）`);
console.log(`  口诀该留（报10/8/4）：留炸 ${holdTotal - holdBombed} / ${holdTotal}（${holdBombed} 次破例须均为残局收尾/以炸还炸）`);
console.log(`  对手危急（≤3 张）：拦 ${critBombed} / ${critTotal}`);
console.log(`  局势平稳（>10 张）：用炸 ${calmBombed} / ${calmTotal}（应趋近 0）`);

console.log('\n抽样决策理由（各 3 条）：');
for (const d of decisions.filter((x) => urgent.has(x.opp)).slice(0, 3)) console.log(`  [报${d.opp}] ${d.bombed ? '炸' : '留'} — ${d.reason}`);
for (const d of decisions.filter((x) => hold.has(x.opp)).slice(0, 3)) console.log(`  [报${d.opp}] ${d.bombed ? '炸' : '留'} — ${d.reason}`);

if (violations.length > 0) {
  console.log('\n违规：');
  for (const v of violations) console.log('  ✗', v);
  process.exit(1);
}
assert.ok(decisions.length >= 10, '决策点样本量应足够');
console.log('\n口诀执行无违规 ✅');
