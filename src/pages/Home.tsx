import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { Card as UICard, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { GraduationCap, Lightbulb, Trophy, RotateCcw, Share2, Brain, Eye } from 'lucide-react'
import type { Card } from '@/lib/guandan/cards.ts'
import { cardLabel, RANK_LABELS, sortCards } from '@/lib/guandan/cards.ts'
import { GuandanHand, newMatch, advanceMatch, handLevel, seatName, type MatchState, type HandResult } from '@/lib/guandan/game.ts'
import { recommend, evaluate, review, QUIZ, quizBonus, CHAT_CHIPS, coachChat, openingReview, type Correction, type Recommendation, type ChatMsg } from '@/lib/guandan/coach.ts'
import { ratingDelta, tierOf, goldenLine, clampRating } from '@/lib/guandan/rating.ts'
import { TYPE_NAMES } from '@/lib/guandan/patterns.ts'
import { CardView } from '@/components/CardView'
import Endgame from '@/pages/Endgame'
import { trackCards } from '@/lib/guandan/tracker.ts'

const STORE_KEY = 'guandan-coach-v1'

interface Profile {
  rating: number
  hands: number
  wins: number
  quizDone: boolean
}

function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (p && Number.isFinite(p.rating)) {
      return { rating: clampRating(p.rating), hands: p.hands | 0, wins: p.wins | 0, quizDone: !!p.quizDone }
    }
  } catch { /* ignore */ }
  return { rating: 1000, hands: 0, wins: 0, quizDone: false }
}

interface HandSummary {
  res: HandResult
  report: ReturnType<typeof review>
  delta: number
  matchText: string
}

export default function Home() {
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [mode, setMode] = useState<'match' | 'endgame'>('match')
  const [match, setMatch] = useState<MatchState>(newMatch)
  const [prevResult, setPrevResult] = useState<HandResult | null>(null)
  const gameRef = useRef<GuandanHand | null>(null)
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [recs, setRecs] = useState<Recommendation[] | null>(null)
  const [correction, setCorrection] = useState<Correction | null>(null)
  const [pendingCards, setPendingCards] = useState<Card[] | null>(null)
  const [summary, setSummary] = useState<HandSummary | null>(null)
  const [quizStep, setQuizStep] = useState(profile.quizDone ? -1 : 0)
  const [quizScore, setQuizScore] = useState(0)
  const [sortMode, setSortMode] = useState<'rank' | 'suit' | 'group'>('rank')
  const [customOrder, setCustomOrder] = useState<number[] | null>(null) // 自由理牌顺序（卡牌 id 序列）
  const dragId = useRef<number | null>(null)
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [showOpening, setShowOpening] = useState(true) // 开牌点评卡片
  const bump = () => setTick((v) => v + 1)

  // 理牌：三种预设排序 + 自由拖拽顺序优先
  const sortedHand = (cards: Card[]): Card[] => {
    if (customOrder) {
      const byId = new Map(cards.map((c) => [c.id, c]))
      const ordered = customOrder.map((id) => byId.get(id)).filter((c): c is Card => !!c)
      const inOrder = new Set(customOrder)
      const rest = cards.filter((c) => !inOrder.has(c.id)) // 新进贡的牌排在末尾
      return [...ordered, ...rest]
    }
    if (sortMode === 'rank') return sortCards(cards, level)
    if (sortMode === 'suit') {
      return [...cards].sort((a, b) => a.suit - b.suit || a.rank - b.rank)
    }
    // 按牌型：同点张数多的（炸弹/三同）排前面，其余按点
    const count = new Map<number, number>()
    for (const c of cards) count.set(c.rank, (count.get(c.rank) ?? 0) + 1)
    return [...cards].sort((a, b) => {
      const g = (count.get(b.rank) ?? 0) - (count.get(a.rank) ?? 0)
      return g !== 0 ? g : a.rank - b.rank
    })
  }

  // 自由理牌：拖拽到目标位置插入
  const handleDrop = (targetId: number) => {
    const fromId = dragId.current
    dragId.current = null
    const g = gameRef.current
    if (fromId === null || fromId === targetId || !g) return
    const ids = sortedHand(g.hands[0]).map((c) => c.id)
    const fromIdx = ids.indexOf(fromId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, fromId)
    setCustomOrder(ids)
  }

  const game = gameRef.current
  const level = handLevel(match)

  const newHand = () => {
    const seed = typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 2 ** 31)
    const g = new GuandanHand(seed, level, prevResult)
    gameRef.current = g
    setSelected(new Set())
    setRecs(null)
    setCorrection(null)
    setSummary(null)
    setChat([])
    setCustomOrder(null)
    setShowOpening(true)
    bump()
  }
  if (!game) newHand()

  // AI 自动行动
  useEffect(() => {
    const g = gameRef.current
    if (!g || summary) return
    if (g.phase === 'play' && g.currentSeat !== 0) {
      const timer = setTimeout(() => {
        g.autoStep()
        bump()
      }, 650)
      return () => clearTimeout(timer)
    }
    if (g.phase === 'done' && !summary) {
      const res = g.result()
      setPrevResult(res) // 关键：下一手凭此触发进贡/还贡
      const rep = review(g, '')
      const myDelta = res.myTeamDelta
      const headIsMine = [0, 2].includes(res.headSeat)
      const oppDelta = headIsMine ? 0 : (() => {
        const partner = res.headSeat === 1 ? 3 : 1
        const pos = res.order.indexOf(partner)
        return pos === 1 ? 3 : pos === 2 ? 2 : 1
      })()
      const delta = ratingDelta({ won: headIsMine, myDelta, oppDelta, accuracy: rep.accuracy, matchOver: false })
      const matchText = advanceMatch(match, res)
      setMatch({ ...match })
      setProfile((p) => {
        const next = { ...p, rating: clampRating(p.rating + delta), hands: p.hands + 1, wins: p.wins + (headIsMine ? 1 : 0) }
        try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
      setSummary({ res, report: rep, delta, matchText })
    }
  }, [tick, summary, match])

  const toggleCard = (c: Card) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(c.id)) next.delete(c.id)
      else next.add(c.id)
      return next
    })
  }

  const attachVerdict = (g: GuandanHand, verdict: 'good' | 'ok' | 'suboptimal' | 'blunder', pScore: number, topScore: number) => {
    const last = g.log[g.log.length - 1]
    if (last && last.seat === 0) {
      last.verdict = verdict
      last.playerScore = pScore
      last.coachTopScore = topScore
    }
  }

  const confirmPlay = (cards: Card[] | null, verdictOverride?: 'suboptimal' | 'blunder') => {
    const g = gameRef.current
    if (!g) return
    const corr = evaluate(g, 0, cards)
    if (!verdictOverride && (corr.verdict === 'suboptimal' || corr.verdict === 'blunder')) {
      setPendingCards(cards)
      setCorrection(corr)
      return
    }
    if (corr.verdict === 'illegal') {
      toast.error(corr.message)
      return
    }
    const err = g.play(0, cards)
    if (err) {
      toast.error(err)
      return
    }
    attachVerdict(g, verdictOverride ?? corr.verdict,
      0, corr.better?.score ?? 0)
    setSelected(new Set())
    setCorrection(null)
    setPendingCards(null)
    setRecs(null)
    bump()
  }

  const handleAskCoach = () => {
    const g = gameRef.current
    if (!g || g.phase !== 'play' || g.currentSeat !== 0) return
    setRecs(recommend(g, 0))
  }

  // 军师多轮对话
  const handleChat = (chipId: string, text: string) => {
    const g = gameRef.current
    if (!g) return
    const answer = coachChat(chipId, g, 0, correction)
    setChat((c) => [...c, { from: 'player' as const, text }, { from: 'coach' as const, text: answer }].slice(-12))
  }

  const adoptBetter = () => {
    if (!correction?.better) return
    const g = gameRef.current
    if (!g) return
    const cards = correction.better.play ? correction.better.play.cards : null
    const err = g.play(0, cards)
    if (err) { toast.error(err); return }
    attachVerdict(g, 'good', correction.better.score, correction.better.score)
    setSelected(new Set())
    setCorrection(null)
    setPendingCards(null)
    setRecs(null)
    bump()
  }

  const tier = tierOf(profile.rating)
  const isMyTurn = !!game && game.phase === 'play' && game.currentSeat === 0 && !summary
  const lastPlayView = game?.roundLog().filter((l) => l.play).slice().reverse() ?? []
  const tracker = game ? trackCards(game, level) : []
  const opening = game && showOpening ? openingReview(game.hands[0], level) : null

  // 进贡/还贡信息（本手开局时展示）
  const tributeLines: string[] = []
  if (game?.tribute && game.turn === 0) {
    const t = game.tribute
    if (t.resisted) {
      tributeLines.push('💪 败方合计持有两张大王——抗贡成功，本手免贡！')
    } else {
      for (const p of t.pairs) {
        const given = t.given.get(p.giver)
        const back = t.returned.get(p.receiver)
        tributeLines.push(
          `🎁 ${seatName(p.giver)} 向 ${seatName(p.receiver)} 进贡 ${given ? cardLabel(given) : ''}` +
          (back ? `，还贡 ${cardLabel(back)}` : p.receiver === 0 ? '，等待你还贡…' : ''),
        )
      }
      if (t.double) tributeLines.push('（双下双贡）')
    }
  }

  // ---------- 战报海报 ----------
  const posterRef = useRef<HTMLCanvasElement | null>(null)
  const drawPoster = () => {
    const cv = posterRef.current
    if (!cv || !summary) return
    const ctx = cv.getContext('2d')!
    const W = 750, H = 1000
    cv.width = W; cv.height = H
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#1e1b4b')
    grad.addColorStop(1, '#0f172a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#f59e0b'
    ctx.font = 'bold 52px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('掼蛋军师 · 战报', W / 2, 90)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 40px sans-serif'
    const wonHand = [0, 2].includes(summary.res.headSeat)
    ctx.fillText(wonHand ? '胜利！' : '惜败', W / 2, 170)
    ctx.font = '28px sans-serif'
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText(summary.matchText, W / 2, 220)
    ctx.fillStyle = '#fbbf24'
    ctx.font = 'bold 64px sans-serif'
    ctx.fillText(`${profile.rating}`, W / 2, 320)
    ctx.font = '26px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`掼力值 ${summary.delta >= 0 ? '+' : ''}${summary.delta} · 段位「${tier.name}」`, W / 2, 365)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '24px sans-serif'
    ctx.fillText(`决策准确率 ${(summary.report.accuracy * 100).toFixed(0)}% · 历史 ${profile.hands} 局 ${profile.wins} 胜`, W / 2, 410)
    let y = 480
    ctx.textAlign = 'left'
    ctx.fillStyle = '#f59e0b'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('⚡ 精彩时刻', 60, y)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '22px sans-serif'
    const hls = summary.report.highlights
    if (hls.length === 0) { y += 44; ctx.fillText('稳扎稳打的一局，下局争取打出炸弹！', 60, y) }
    for (const h of hls) { y += 44; ctx.fillText(`· ${h.text}`, 60, y); }
    y += 70
    ctx.strokeStyle = '#334155'
    ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y); ctx.stroke()
    y += 50
    ctx.fillStyle = '#94a3b8'
    ctx.font = 'italic 24px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`「${goldenLine(profile.hands)}」`, W / 2, y)
    ctx.fillStyle = '#64748b'
    ctx.font = '20px sans-serif'
    ctx.fillText('掼蛋军师 · AI 教你打掼蛋', W / 2, H - 50)
  }

  const downloadPoster = () => {
    const cv = posterRef.current
    if (!cv) return
    drawPoster()
    const a = document.createElement('a')
    a.href = cv.toDataURL('image/png')
    a.download = '掼蛋军师战报.png'
    a.click()
    toast.success('战报图已下载，去朋友圈分享吧！')
  }

  const quiz = QUIZ[quizStep]

  if (mode === 'endgame') {
    return (
      <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
        <Toaster richColors position="top-center" />
        <Endgame onBack={() => setMode('match')} />
      </div>
    )
  }

  return (
    <div className="dark min-h-screen bg-neutral-950 text-neutral-100">
      <Toaster richColors position="top-center" />
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3">
        <GraduationCap className="h-6 w-6 text-amber-400" />
        <div className="mr-auto">
          <h1 className="text-lg font-bold">掼蛋军师 · AI 教你打掼蛋</h1>
          <p className="text-xs text-neutral-400">事前指导 · 事中纠正 · 事后复盘 · 掼力定段</p>
        </div>
        <Badge variant="secondary" className="text-sm">打 {RANK_LABELS[level]}</Badge>
        <Badge className="bg-amber-500 text-neutral-950 text-sm">掼力 {profile.rating} · {tier.name}</Badge>
        <Badge variant="outline" className="text-sm">{profile.hands} 局 {profile.wins} 胜</Badge>
        <Button size="sm" variant="outline" onClick={() => setMode('endgame')}>🧩 残局挑战</Button>
      </header>

      <main className="mx-auto max-w-6xl p-2 sm:p-4" data-tick={tick}>
        {game && (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* ---------- 牌桌 ---------- */}
            <UICard className="border-neutral-800 bg-emerald-950/40">
              <CardContent className="space-y-3 p-4">
                {/* 搭档 */}
                <SeatRow seat={2} game={game} lastPlayView={lastPlayView} />
                <div className="grid grid-cols-2 gap-3">
                  <SeatRow seat={3} game={game} lastPlayView={lastPlayView} side />
                  <SeatRow seat={1} game={game} lastPlayView={lastPlayView} side />
                </div>

                {/* 中央信息 + 报牌 */}
                <div className="rounded-lg bg-neutral-900/70 p-3 text-center text-sm">
                  {tributeLines.length > 0 && (
                    <div className="mb-1 space-y-0.5">
                      {tributeLines.map((l, i) => <p key={i} className="text-violet-300">{l}</p>)}
                    </div>
                  )}
                  {game.phase === 'tribute-return' && <p className="text-amber-300">进贡完成，请选择一张牌还贡（≤10 的牌）</p>}
                  {game.phase === 'play' && (
                    <p>
                      轮到 <span className="font-bold text-amber-300">{seatName(game.currentSeat)}</span>
                      {game.lastPlay && game.lastSeat !== -1 && (
                        <span className="text-neutral-400">　须压：{seatName(game.lastSeat)} 的 {TYPE_NAMES[game.lastPlay.type]}（{cardLabel(game.lastPlay.cards[0])} 起）</span>
                      )}
                      {(!game.lastPlay || game.lastSeat === -1) && <span className="text-neutral-400">　领出任意牌型</span>}
                    </p>
                  )}
                  {game.phase === 'done' && <p className="text-emerald-300">本手结束，查看复盘 →</p>}
                  {/* 报牌：≤10 张公示 */}
                  {game.phase === 'play' && (
                    <div className="mt-1 flex justify-center gap-3">
                      {[0, 1, 2, 3].filter((s) => game.hands[s].length > 0 && game.hands[s].length <= 10).map((s) => (
                        <span key={s} className={`rounded-full px-2 py-0.5 text-xs font-bold ${s === 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'} animate-pulse`}>
                          📢 {seatName(s)} 报牌：剩 {game.hands[s].length} 张
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 玩家手牌 + 理牌 */}
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                    <span>你的手牌（{game.hands[0].length} 张）</span>
                    {isMyTurn && <Badge className="bg-amber-500 text-neutral-950">轮到你</Badge>}
                    <span className="ml-auto flex gap-1">
                      {([['rank', '按大小'], ['suit', '按花色'], ['group', '按牌型']] as const).map(([m, label]) => (
                        <button key={m}
                          onClick={() => { setSortMode(m); setCustomOrder(null) }}
                          className={`rounded px-2 py-0.5 text-xs ${sortMode === m && !customOrder ? 'bg-amber-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>
                          {label}
                        </button>
                      ))}
                      <span className="self-center text-xs text-neutral-500">🖐 拖动牌可自由理牌{customOrder ? '（已自定义）' : ''}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 sm:gap-1.5 rounded-lg bg-neutral-900/70 p-2 sm:p-3 min-h-[96px]">
                    {sortedHand(game.hands[0]).map((c) => (
                      <span key={c.id}
                        draggable={game.phase === 'tribute-return' || isMyTurn || game.phase === 'play'}
                        onDragStart={() => { dragId.current = c.id }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(c.id)}
                        className="inline-block">
                        <CardView c={c} selected={selected.has(c.id)}
                          wild={c.suit === 1 && c.rank === level}
                          onClick={game.phase === 'tribute-return' || isMyTurn ? () => toggleCard(c) : undefined} />
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {game.phase === 'tribute-return' ? (
                      <Button disabled={selected.size !== 1} onClick={() => {
                        const id = [...selected][0]
                        if (game.playerReturn(id)) { setSelected(new Set()); bump() }
                      }}>还贡这张牌</Button>
                    ) : (
                      <>
                        <Button disabled={!isMyTurn || selected.size === 0}
                          onClick={() => confirmPlay(game.hands[0].filter((c) => selected.has(c.id)))}>
                          出牌（{selected.size}）
                        </Button>
                        <Button variant="secondary" disabled={!isMyTurn} onClick={() => confirmPlay(null)}>不出</Button>
                        <Button variant="outline" disabled={!isMyTurn} onClick={handleAskCoach}>
                          <Lightbulb className="mr-1 h-4 w-4" />问军师
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </UICard>

            {/* ---------- 教练面板 ---------- */}
            <div className="space-y-4">
              {game && tracker.length > 0 && (
                <UICard className="border-neutral-800 bg-neutral-900">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-sky-400" />记牌器</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {tracker.map((it) => (
                        <span
                          key={it.key}
                          className={
                            it.left === 0
                              ? 'rounded-full px-2 py-0.5 bg-neutral-800/50 text-neutral-600 line-through'
                              : it.left <= 2
                                ? 'rounded-full px-2 py-0.5 bg-rose-500/20 text-rose-300 font-bold'
                                : 'rounded-full px-2 py-0.5 bg-neutral-800 text-neutral-300'
                          }
                        >
                          {it.label} 剩{it.left}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-neutral-500">未出现 = 总数 − 全场已出 − 你的手牌；剩 2 张以内红色预警</p>
                  </CardContent>
                </UICard>
              )}
              {opening && (
                <UICard className="border-sky-500/40 bg-sky-950/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GraduationCap className="h-4 w-4 text-sky-400" />开牌点评
                      <Badge className={opening.grade === '强' ? 'bg-amber-500 text-neutral-950' : opening.grade === '偏弱' ? 'bg-neutral-700 text-neutral-300' : 'bg-sky-600 text-white'}>
                        牌力{opening.grade}
                      </Badge>
                      <button onClick={() => setShowOpening(false)} className="ml-auto text-xs text-neutral-500 hover:text-neutral-300">收起 ✕</button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs leading-relaxed text-neutral-200">
                    {opening.lines.map((l, i) => <p key={i}>· {l}</p>)}
                  </CardContent>
                </UICard>
              )}
              <UICard className="border-neutral-800 bg-neutral-900">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-amber-400" />军师指导</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {correction ? (
                    <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-950/40 p-3">
                      <p className="font-medium text-rose-300">⚠️ 事中纠正</p>
                      <p className="text-neutral-200">{correction.message}</p>
                      <div className="flex gap-2">
                        {correction.better && (
                          <Button size="sm" onClick={adoptBetter}>改出推荐：{correction.better.label}</Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => confirmPlay(pendingCards, correction.verdict as 'suboptimal' | 'blunder')}>坚持我的选择</Button>
                      </div>
                    </div>
                  ) : recs ? (
                    <div className="space-y-2">
                      <p className="font-medium text-amber-300">💡 事前指导</p>
                      {recs.map((r, i) => (
                        <div key={i} className={`rounded-lg border p-2 ${i === 0 ? 'border-amber-500/50 bg-amber-950/30' : 'border-neutral-700 bg-neutral-800/50'}`}>
                          <p className="font-medium">{i === 0 ? '主推' : `备选${i}`}：{r.label}</p>
                          <p className="text-neutral-400">{r.reason}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-neutral-400">
                      {isMyTurn ? '轮到你了。选好牌点「出牌」我会即时点评；没主意就点「问军师」。' : '观战中…轮到你时我会给出建议。'}
                    </p>
                  )}

                  {/* 军师多轮对话 */}
                  <div className="space-y-2 border-t border-neutral-800 pt-2">
                    {chat.length > 0 && (
                      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                        {chat.map((m, i) => (
                          <div key={i} className={m.from === 'player' ? 'text-right' : ''}>
                            <span className={`inline-block max-w-[95%] rounded-lg px-2 py-1 text-left text-xs leading-relaxed ${m.from === 'player' ? 'bg-amber-500/20 text-amber-200' : 'bg-neutral-800 text-neutral-200'}`}>
                              {m.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-neutral-500">💬 追问军师（可多轮）：</p>
                    <div className="flex flex-wrap gap-1">
                      {CHAT_CHIPS.map((chip) => (
                        <button key={chip.id} onClick={() => handleChat(chip.id, chip.text)}
                          className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-amber-500/30 hover:text-amber-200">
                          {chip.text}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </UICard>

              {/* 历史出牌（整局） */}
              <UICard className="border-neutral-800 bg-neutral-900">
                <CardHeader className="pb-2"><CardTitle className="text-base">历史出牌</CardTitle></CardHeader>
                <CardContent className="max-h-56 space-y-1 overflow-y-auto text-xs text-neutral-300">
                  {[...game.log].reverse().slice(0, 30).map((l) => (
                    <div key={l.turn} className="flex justify-between gap-2">
                      <span className={l.seat === 0 ? 'text-amber-300' : ''}>#{l.turn} {seatName(l.seat)}</span>
                      <span className={l.isBomb ? 'text-rose-400 font-bold' : ''}>
                        {l.label}{l.verdict === 'blunder' ? ' ❌' : l.verdict === 'suboptimal' ? ' ⚠️' : l.verdict === 'good' ? ' ✅' : ''}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </UICard>
            </div>
          </div>
        )}
      </main>

      {/* ---------- 摸底测验 ---------- */}
      <Dialog open={quizStep >= 0} onOpenChange={() => {}}>
        <DialogContent className="bg-neutral-900 text-neutral-100" onInteractOutside={(e) => e.preventDefault()}>
          {quiz ? (
            <>
              <DialogHeader><DialogTitle>牌力摸底（{quizStep + 1}/3）</DialogTitle></DialogHeader>
              <p className="text-sm">{quiz.question}</p>
              <div className="space-y-2">
                {quiz.options.map((op, i) => (
                  <Button key={i} variant="outline" className="w-full justify-start" onClick={() => {
                    const right = i === quiz.answer
                    if (right) setQuizScore((s) => s + 1)
                    toast[right ? 'success' : 'error'](right ? '答对了！' : `答错了。${quiz.explain}`)
                    if (quizStep < 2) setQuizStep(quizStep + 1)
                    else {
                      const bonus = quizBonus(quizScore + (right ? 1 : 0))
                      setProfile((p) => {
                        const next = { ...p, rating: clampRating(p.rating + bonus), quizDone: true }
                        try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
                        return next
                      })
                      toast.success(`摸底完成！掼力修正 ${bonus >= 0 ? '+' : ''}${bonus}，开始实战吧！`)
                      setQuizStep(-1)
                    }
                  }}>{op}</Button>
                ))}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ---------- 复盘报告 ---------- */}
      <Dialog open={!!summary} onOpenChange={() => {}}>
        <DialogContent className="max-w-2xl bg-neutral-900 text-neutral-100" onInteractOutside={(e) => e.preventDefault()}>
          {summary && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-400" />本手复盘
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-base font-medium">{summary.matchText}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">掼力 {summary.delta >= 0 ? '+' : ''}{summary.delta} → {profile.rating}</Badge>
                  <Badge variant="secondary">段位「{tier.name}」</Badge>
                  <Badge variant="secondary">名次：{summary.res.order.map(seatName).join(' → ')}</Badge>
                </div>
                <div>
                  <p className="mb-1 text-neutral-400">决策准确率 {(summary.report.accuracy * 100).toFixed(0)}%</p>
                  <Progress value={summary.report.accuracy * 100} />
                </div>
                <Separator />
                {summary.report.mistakes.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium text-rose-300">关键失误</p>
                    {summary.report.mistakes.map((m) => <p key={m.turn} className="text-neutral-300">· {m.text}</p>)}
                  </div>
                )}
                <div>
                  <p className="mb-1 font-medium text-emerald-300">军师建议</p>
                  {summary.report.tips.map((tip, i) => <p key={i} className="text-neutral-300">· {tip}</p>)}
                </div>
                <div>
                  <p className="mb-1 font-medium text-amber-300">精彩时刻</p>
                  {summary.report.highlights.length === 0
                    ? <p className="text-neutral-400">本局平稳，下局争取打出高光操作！</p>
                    : summary.report.highlights.map((h, i) => <p key={i} className="text-neutral-300">⚡ {h.text}</p>)}
                </div>
                <canvas ref={posterRef} className="hidden" />
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={downloadPoster}><Share2 className="mr-1 h-4 w-4" />生成战报图发朋友圈</Button>
                  <Button variant="secondary" onClick={() => { newHand() }}>
                    <RotateCcw className="mr-1 h-4 w-4" />再来一局
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setMatch(newMatch()); setPrevResult(null)
                    setTimeout(newHand, 0)
                  }}>重开整局（从 2 打起）</Button>
                </div>
                <p className="text-xs text-neutral-500">提示：微信不允许网页直接分享到朋友圈，战报图保存后手动分享即可。</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SeatRow({ seat, game, lastPlayView, side }: {
  seat: number; game: GuandanHand; lastPlayView: { seat: number; label: string; play: unknown }[]; side?: boolean
}) {
  const active = game.phase === 'play' && game.currentSeat === seat
  const lastPlay = lastPlayView.find((l) => l.seat === seat)
  const finishedPos = game.finished.indexOf(seat)
  return (
    <div className={`rounded-lg border p-2 text-sm ${active ? 'border-amber-400 bg-amber-950/30' : 'border-neutral-700 bg-neutral-900/60'} ${side ? '' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{seatName(seat)}</span>
        {game.hands[seat].length > 0 && game.hands[seat].length <= 10 ? (
          <Badge className="bg-rose-600 animate-pulse">报 {game.hands[seat].length} 张</Badge>
        ) : (
          <Badge variant="outline">{game.hands[seat].length} 张</Badge>
        )}
        {finishedPos >= 0 && <Badge className="bg-emerald-600">第 {finishedPos + 1} 出完</Badge>}
        {active && <Badge className="bg-amber-500 text-neutral-950">思考中…</Badge>}
      </div>
      {lastPlay && <p className="mt-1 text-neutral-300">最近出牌：{String(lastPlay.label)}</p>}
    </div>
  )
}
