import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card as UICard, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Puzzle as PuzzleIcon, RotateCcw, ArrowLeft, CheckCircle2, XCircle, MinusCircle, ListOrdered, Share2 } from 'lucide-react'
import { CardView } from '@/components/CardView'
import type { Card } from '@/lib/guandan/cards.ts'
import { sortCards, cardsLabel, RANK_LABELS } from '@/lib/guandan/cards.ts'
import { analyze, beat, TYPE_NAMES } from '@/lib/guandan/patterns.ts'
import type { Play } from '@/lib/guandan/patterns.ts'
import { seatName } from '@/lib/guandan/game.ts'
import { goldenLine } from '@/lib/guandan/rating.ts'
import {
  CLASSICS, genPuzzleD, diffOfSolved, DIFF_INFO, initialState, applyMove, teamAMove, heuristicMove,
  evaluateLine, clearSolver,
} from '@/lib/guandan/endgame.ts'
import type { Puzzle, EndState, LineReport, Difficulty } from '@/lib/guandan/endgame.ts'

const EG_KEY = 'guandan-endgame-v1'

interface EgProfile {
  score: number
  solved: number
  played: number
}

function loadEg(): EgProfile {
  try {
    const p = JSON.parse(localStorage.getItem(EG_KEY) ?? 'null')
    if (p && Number.isFinite(p.score)) return { score: p.score | 0, solved: p.solved | 0, played: p.played | 0 }
  } catch { /* ignore */ }
  return { score: 0, solved: 0, played: 0 }
}

interface MoveRecord {
  seat: number
  play: Play | null
}

export default function Endgame({ onBack }: { onBack: () => void }) {
  const [eg, setEg] = useState<EgProfile>(loadEg)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [st, setSt] = useState<EndState | null>(null)
  const [records, setRecords] = useState<MoveRecord[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [report, setReport] = useState<LineReport | null>(null)
  const [puzzleNo, setPuzzleNo] = useState(0)
  const [diff, setDiff] = useState<Difficulty>('easy')
  const finalized = useRef(false)

  const startPuzzle = (no: number) => {
    clearSolver()
    const d = diffOfSolved(eg.solved)
    let pz: Puzzle | null = null
    if (no === 0) {
      pz = CLASSICS[0].puzzle()
    } else {
      const seed = Math.floor(Math.random() * 2 ** 31)
      const level = 2 + Math.floor(Math.random() * 13)
      pz = genPuzzleD(seed, level, d)
      if (!pz) pz = CLASSICS[no % CLASSICS.length].puzzle()
    }
    setDiff(d)
    setPuzzle(pz)
    setSt(initialState(pz.hands.map((h) => [...h]), pz.level))
    setRecords([])
    setSelected(new Set())
    setReport(null)
    finalized.current = false
    setPuzzleNo(no)
  }

  if (!puzzle || !st) startPuzzle(puzzleNo)

  // AI 自动行动（对方启发式；搭档走取胜着法）
  useEffect(() => {
    if (!st || st.finished.length > 0 || report) return
    if (st.seat === 0) return
    const timer = setTimeout(() => {
      const m = st.seat % 2 === 0 ? teamAMove(st) : heuristicMove(st)
      setRecords((r) => [...r, { seat: st.seat, play: m }])
      setSt(applyMove(st, m))
    }, 750)
    return () => clearTimeout(timer)
  }, [st, report])

  // 终局结算：生成逐步复盘 + 更新残局分
  useEffect(() => {
    if (!st || !puzzle || st.finished.length === 0 || report || finalized.current) return
    finalized.current = true
    const rep = evaluateLine(puzzle, records, st.finished[0])
    setReport(rep)
    setEg((p) => {
      const next = {
        score: p.score + (rep.solved ? DIFF_INFO[diff].score : 15),
        solved: p.solved + (rep.solved ? 1 : 0),
        played: p.played + 1,
      }
      try { localStorage.setItem(EG_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [st, puzzle, records, report, diff])

  const isMyTurn = !!st && st.finished.length === 0 && st.seat === 0 && !report

  const toggleCard = (c: Card) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(c.id)) next.delete(c.id)
      else next.add(c.id)
      return next
    })
  }

  const doPlay = (cards: Card[] | null) => {
    if (!st || !isMyTurn) return
    let playObj: Play | null = null
    const leading = st.lastSeat === -1 || st.lastSeat === 0
    if (cards && cards.length > 0) {
      playObj = analyze(cards, st.level)
      if (!playObj) { toast.error('这不是合法牌型'); return }
      if (!leading && st.lastPlay && !beat(playObj, st.lastPlay, st.level)) {
        toast.error(`压不过${seatName(st.lastSeat)}的${TYPE_NAMES[st.lastPlay.type]}`)
        return
      }
    } else {
      if (leading) { toast.error('轮到你领出，不能不出'); return }
    }
    setRecords((r) => [...r, { seat: 0, play: playObj }])
    setSt(applyMove(st, playObj))
    setSelected(new Set())
  }

  const myHand = st ? sortCards(st.hands[0], st.level) : []
  const levelLabel = puzzle ? RANK_LABELS[puzzle.level] : ''

  // ---------- 残局战报海报 ----------
  const posterRef = useRef<HTMLCanvasElement | null>(null)
  const drawPoster = () => {
    const cv = posterRef.current
    if (!cv || !report || !puzzle) return
    const ctx = cv.getContext('2d')!
    const W = 750, H = 1000
    cv.width = W; cv.height = H
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#052e22')
    grad.addColorStop(1, '#0f172a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#34d399'
    ctx.font = 'bold 52px sans-serif'
    ctx.fillText('掼蛋残局 · 战报', W / 2, 90)
    ctx.fillStyle = report.solved ? '#6ee7b7' : '#fda4af'
    ctx.font = 'bold 40px sans-serif'
    ctx.fillText(report.solved ? '破解成功！' : '未能破解', W / 2, 170)
    ctx.font = '26px sans-serif'
    ctx.fillStyle = '#cbd5e1'
    const title = `第 ${puzzleNo + 1} 题 · ${puzzle.classic ? `经典「${puzzle.classic}」` : '随机残局'} · 难度·${DIFF_INFO[diff].name} · 打 ${levelLabel}`
    ctx.fillText(title, W / 2, 220)
    ctx.fillStyle = '#fbbf24'
    ctx.font = 'bold 64px sans-serif'
    ctx.fillText(`${eg.score}`, W / 2, 320)
    ctx.font = '26px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`残局分 · 破解 ${eg.solved}/${eg.played}`, W / 2, 365)
    // 我的起手
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '24px sans-serif'
    ctx.fillText(`我的起手：${cardsLabel(puzzle.hands[0])}`, W / 2, 415)
    // 关键步骤
    let y = 470
    ctx.textAlign = 'left'
    ctx.fillStyle = '#34d399'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('🧩 行棋记录', 60, y)
    ctx.font = '22px sans-serif'
    const mySteps = report.steps.filter((s) => s.mine)
    for (const s of mySteps.slice(0, 5)) {
      y += 44
      ctx.fillStyle = s.verdict === 'correct' ? '#6ee7b7' : s.verdict === 'wrong' ? '#fda4af' : '#94a3b8'
      const mark = s.verdict === 'correct' ? '✓' : s.verdict === 'wrong' ? '✗' : '·'
      ctx.fillText(`${mark} ${s.label}`, 60, y)
      if (s.verdict === 'wrong' && s.bestLabel) {
        y += 36
        ctx.fillStyle = '#94a3b8'
        ctx.font = '20px sans-serif'
        ctx.fillText(`  正解：${s.bestLabel}`, 60, y)
        ctx.font = '22px sans-serif'
      }
    }
    if (mySteps.length === 0) { y += 44; ctx.fillStyle = '#94a3b8'; ctx.fillText('未及出手，残局已定。', 60, y) }
    y += 70
    ctx.strokeStyle = '#334155'
    ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke()
    y += 50
    ctx.fillStyle = '#94a3b8'
    ctx.font = 'italic 24px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`「${goldenLine(eg.played)}」`, W / 2, y)
    ctx.fillStyle = '#64748b'
    ctx.font = '20px sans-serif'
    ctx.fillText('掼蛋军师 · 残局唯一正解挑战', W / 2, H - 50)
  }

  const downloadPoster = () => {
    const cv = posterRef.current
    if (!cv) return
    drawPoster()
    const a = document.createElement('a')
    a.href = cv.toDataURL('image/png')
    a.download = `掼蛋残局战报-第${puzzleNo + 1}题.png`
    a.click()
    toast.success('战报图已下载，去朋友圈分享吧！')
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3">
        <PuzzleIcon className="h-6 w-6 text-emerald-400" />
        <div className="mr-auto">
          <h1 className="text-lg font-bold">掼蛋残局 · 唯一正解挑战</h1>
          <p className="text-xs text-neutral-400">无提示 · 无纠正 · 破解后逐步复盘</p>
        </div>
        {puzzle && <Badge variant="secondary" className="text-sm">打 {levelLabel}</Badge>}
        <Badge className="bg-emerald-500 text-neutral-950 text-sm">残局分 {eg.score}</Badge>
        <Badge variant="outline" className="text-sm">破解 {eg.solved}/{eg.played}</Badge>
        <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />完整对局</Button>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* ---------- 牌桌 ---------- */}
          <UICard className="border-neutral-800 bg-emerald-950/40">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-emerald-300">
                  第 {puzzleNo + 1} 题{puzzle?.classic ? ` · 经典残局「${puzzle.classic}」` : ' · 随机残局'}
                  <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                    难度·{DIFF_INFO[diff].name}（{DIFF_INFO[diff].desc}）
                  </span>
                </span>
                <Button size="sm" variant="ghost" className="text-neutral-400" onClick={() => startPuzzle(puzzleNo + 1)}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />换一题
                </Button>
              </div>

              {/* 其他三家 */}
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                {[3, 2, 1].map((s) => (
                  <div key={s} className={`rounded-lg p-2 ${st && st.seat === s && st.finished.length === 0 ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : 'bg-neutral-900/70'}`}>
                    <p className="text-neutral-300">{seatName(s)}</p>
                    <p className="text-lg font-bold">{st?.hands[s].length ?? 0} 张</p>
                  </div>
                ))}
              </div>

              {/* 中央状态 */}
              <div className="rounded-lg bg-neutral-900/70 p-3 text-center text-sm">
                {st && st.finished.length === 0 ? (
                  <p>
                    轮到 <span className="font-bold text-amber-300">{seatName(st.seat)}</span>
                    {st.lastPlay && st.lastSeat !== -1 && st.lastSeat !== st.seat
                      ? <span className="text-neutral-400">　须压：{seatName(st.lastSeat)} 的 {TYPE_NAMES[st.lastPlay.type]}</span>
                      : <span className="text-neutral-400">　领出任意牌型</span>}
                  </p>
                ) : (
                  <p className={report?.solved ? 'text-emerald-300' : 'text-rose-300'}>
                    {report?.solved ? '🎉 破解成功！' : st && st.finished[0] % 2 === 0 ? '己方头游，但过程有瑕疵' : '未能破解'}
                  </p>
                )}
                {st?.lastPlay && st.finished.length === 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    当前最大：{seatName(st.lastSeat)} 的 {TYPE_NAMES[st.lastPlay.type]}
                  </p>
                )}
              </div>

              {/* 玩家手牌 */}
              <div>
                <div className="mb-1 flex items-center gap-2 text-sm text-neutral-300">
                  <span>你的手牌（{st?.hands[0].length ?? 0} 张）</span>
                  {isMyTurn && <Badge className="bg-amber-500 text-neutral-950">轮到你</Badge>}
                </div>
                <div className="flex min-h-[96px] flex-wrap gap-1.5 rounded-lg bg-neutral-900/70 p-3">
                  {myHand.map((c) => (
                    <CardView key={c.id} c={c} selected={selected.has(c.id)}
                      wild={c.suit === 1 && c.rank === st?.level}
                      onClick={isMyTurn ? () => toggleCard(c) : undefined} />
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button disabled={!isMyTurn || selected.size === 0}
                    onClick={() => doPlay(st!.hands[0].filter((c) => selected.has(c.id)))}>
                    出牌（{selected.size}）
                  </Button>
                  <Button variant="secondary" disabled={!isMyTurn} onClick={() => doPlay(null)}>不出</Button>
                </div>
                <p className="mt-2 text-xs text-neutral-500">残局模式没有军师提示——靠你自己找出唯一正解。</p>
              </div>
            </CardContent>
          </UICard>

          {/* ---------- 复盘面板 ---------- */}
          <div className="space-y-4">
            <UICard className="border-neutral-800 bg-neutral-900">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListOrdered className="h-4 w-4 text-emerald-400" />逐步复盘
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!report ? (
                  <>
                    <p className="text-neutral-400">这局残局只有<strong className="text-emerald-300">一种出牌顺序</strong>能保证己方头游。出牌后这里会逐步对答案。</p>
                    {records.length > 0 && (
                      <div className="space-y-1">
                        {records.map((r, i) => (
                          <p key={i} className="text-neutral-300">#{i + 1} {seatName(r.seat)}：{r.play ? r.play.cards.map((c) => RANK_LABELS[c.rank]).join(' ') : '不出'}</p>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className={`rounded-lg border p-3 ${report.solved ? 'border-emerald-500/40 bg-emerald-950/40' : 'border-rose-500/40 bg-rose-950/40'}`}>
                      <p className={`font-bold ${report.solved ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {report.solved ? `🎉 破解成功！+${DIFF_INFO[diff].score} 残局分` : '未能破解 · +15 安慰分'}
                      </p>
                      {!report.solved && <p className="mt-1 text-neutral-300">看看下面哪一步走错了。</p>}
                    </div>
                    <div className="space-y-1.5">
                      {report.steps.map((s, i) => (
                        <div key={i} className={`rounded-md px-2 py-1.5 ${s.verdict === 'wrong' ? 'bg-rose-950/50 ring-1 ring-rose-500/50' : s.verdict === 'correct' ? 'bg-emerald-950/30' : 'bg-neutral-800/40'}`}>
                          <p className="flex items-center gap-1.5">
                            {s.verdict === 'correct' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
                            {s.verdict === 'wrong' && <XCircle className="h-4 w-4 shrink-0 text-rose-400" />}
                            {(s.verdict === 'ai' || s.verdict === 'moot') && <MinusCircle className="h-4 w-4 shrink-0 text-neutral-500" />}
                            <span className={s.mine ? 'font-medium' : 'text-neutral-400'}>
                              #{i + 1} {seatName(s.seat)}：{s.label}
                            </span>
                          </p>
                          {s.verdict === 'correct' && s.reason && <p className="ml-6 text-xs text-emerald-300/80">{s.reason}</p>}
                          {s.verdict === 'wrong' && (
                            <p className="ml-6 text-xs text-rose-300">
                              正解：{s.bestLabel}{s.reason ? `——${s.reason}` : ''}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    <Separator className="bg-neutral-800" />
                    <div>
                      <p className="mb-1 font-medium text-emerald-300">正确线路演示</p>
                      <ol className="list-decimal space-y-0.5 pl-5 text-neutral-300">
                        {report.pv.map((line, i) => <li key={i} className="text-xs">{line}</li>)}
                      </ol>
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 bg-emerald-600 hover:bg-emerald-500" onClick={() => startPuzzle(puzzleNo + 1)}>
                        下一题
                      </Button>
                      <Button variant="outline" onClick={downloadPoster}>
                        <Share2 className="mr-1 h-4 w-4" />战报图
                      </Button>
                    </div>
                    <canvas ref={posterRef} className="hidden" />
                  </>
                )}
              </CardContent>
            </UICard>
          </div>
        </div>
      </main>
    </div>
  )
}
