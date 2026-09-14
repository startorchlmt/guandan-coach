import type { Card } from '@/lib/guandan/cards.ts'
import { RANK_LABELS, SUIT_SYMBOLS } from '@/lib/guandan/cards.ts'

/** 掼蛋专用牌面：左上角小字 rank+suit，中央大花型，王牌专属设计，逢人配金标 */
export function CardView({ c, selected, onClick, small, wild }: {
  c: Card; selected?: boolean; onClick?: () => void; small?: boolean; wild?: boolean
}) {
  const red = c.suit === 1 || c.suit === 3 || c.rank === 16
  const colorCls = red ? 'text-red-600' : 'text-neutral-900'
  const isJoker = c.suit === -1
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`relative inline-flex flex-col rounded-md bg-gradient-to-b from-white to-neutral-100 font-bold shadow-md transition-all border
        ${small ? 'h-12 w-9' : 'h-14 w-10 sm:h-[72px] sm:w-[50px]'}
        ${selected ? '-translate-y-3 border-amber-400 ring-2 ring-amber-400 shadow-amber-400/40' : 'border-neutral-300'}
        ${onClick ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'}
        ${wild ? 'border-rose-400 ring-1 ring-rose-400' : ''}`}
    >
      {isJoker ? (
        <div className={`flex h-full w-full flex-col items-center justify-center ${colorCls}`}>
          <span className={small ? 'text-[10px]' : 'text-[10px] sm:text-xs'}>{c.rank === 16 ? '大王' : '小王'}</span>
          <span className={small ? 'text-sm' : 'text-base sm:text-xl'}>{c.rank === 16 ? '🃏' : '🂿'}</span>
        </div>
      ) : (
        <>
          {/* 左上角标 */}
          <div className={`absolute left-0.5 top-0.5 flex flex-col items-center leading-none ${colorCls} ${small ? 'text-[9px]' : 'text-[9px] sm:text-[11px]'}`}>
            <span>{RANK_LABELS[c.rank]}</span>
            <span>{SUIT_SYMBOLS[c.suit]}</span>
          </div>
          {/* 中央大花型 */}
          <div className={`flex h-full w-full items-center justify-center ${colorCls} ${small ? 'text-base' : 'text-lg sm:text-2xl'}`}>
            <span>{SUIT_SYMBOLS[c.suit]}</span>
          </div>
        </>
      )}
      {wild && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-rose-500 to-amber-500 px-1 text-[8px] font-bold text-white shadow">
          逢人配
        </span>
      )}
    </button>
  )
}
