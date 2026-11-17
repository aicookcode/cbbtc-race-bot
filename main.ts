// Dip-buyer for the cbBTC 24h bars race (agent-fun/bars-replay/v1).
//
// Idea: on one-minute bars of a deep, slow pool, sharp short-horizon drops
// have tended to bounce back, while slow drifts do not pay the round-trip
// cost (about 26 bps at full size: 4 bps fee + 2 bps slippage per side plus
// price impact). So this bot stays in cash and only buys a capitulation-
// sized dip, then lets the bounce run to a fixed take-profit:
//
//   entry  the close is at least DROP_BPS below the close LOOKBACK_BARS
//          bars earlier (a drop of 0.90% within one hour), and the window
//          is not nearly over (no new position after LAST_ENTRY_BAR, so a
//          fresh buy is never flattened before it can work)
//   size   all of the cash on hand, capped by the hello caps' weight room
//   exits  take profit at +TAKE_PROFIT_BPS over the position's cost basis,
//          stop loss at -STOP_LOSS_BPS under it, or a time stop after
//          MAX_HOLD_BARS bars, whichever comes first; a sell the market
//          refuses is simply sent again on the next batch while its
//          reason still holds
//
// The bot reads only the hello it is sent and the bars of each batch: no
// clock, no files, no randomness, so two runs over the same bars send the
// same orders byte for byte. All signal math is float64 + - * / on the
// closes, each correctly rounded, so it is reproducible run after run.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Bars of trailing history the entry drop is measured over (one hour). */
const LOOKBACK_BARS = 60;
/** Entry drop, in basis points of the trailing return (-0.90%). */
const DROP_BPS = 90;
/** Take profit, in basis points over the position's cost basis (+1.35%). */
const TAKE_PROFIT_BPS = 135;
/** Stop loss, in basis points under the position's cost basis (-1.80%). */
const STOP_LOSS_BPS = 180;
/** Time stop: leave a position that has not worked within this many bars. */
const MAX_HOLD_BARS = 600;
/** No new position once this many scored bars have passed (of 1,440). */
const LAST_ENTRY_BAR = 1380;
/** Slippage cap on every order, measured from the close it was decided on. */
const MAX_SLIPPAGE_BPS = 150;

/** Closes of the traded symbol, one per batch that carried its bar. */
const closes: number[] = [];
/** Scored-bar index at which the current position was first seen held. */
let entryBar: number | null = null;

/** The position's mark-to-market return over its cost basis, in bps. */
function returnBps(state: BarsState, symbol: string, qty: bigint, cost: bigint): number {
  const value = state.value(symbol, qty);
  return (Number(value) / Number(cost) - 1) * 10_000;
}

await runBars({
  onBatch(state, batch) {
    // Fold this batch's bar for the traded symbol into the close history.
    const symbol = state.hello.symbols[0]!.symbol;
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol === symbol) {
        closes.push(Number(bar.c));
        fresh = true;
      }
    }
    if (state.warmingUp || !fresh) return [];

    const scoredBar = state.seq - state.warmupBars;
    const held = state.positions.get(symbol);
    const orders: (BuyInput | SellInput)[] = [];

    if (held !== undefined) {
      if (entryBar === null) entryBar = scoredBar;
      const r = returnBps(state, symbol, held.qty, held.cost);
      const heldFor = scoredBar - entryBar;
      if (r >= TAKE_PROFIT_BPS || r <= -STOP_LOSS_BPS || heldFor >= MAX_HOLD_BARS) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }
    entryBar = null;

    // Flat: buy only a capitulation-sized dip, early enough to work.
    if (scoredBar > LAST_ENTRY_BAR) return orders;
    if (closes.length <= LOOKBACK_BARS) return orders;
    const now = closes[closes.length - 1]!;
    const then = closes[closes.length - 1 - LOOKBACK_BARS]!;
    const trailingBps = (now / then - 1) * 10_000;
    if (trailingBps > -DROP_BPS) return orders;

    const room = state.weightRoom(symbol);
    let stake = state.cash < room ? state.cash : room;
    if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return orders;
    orders.push({ side: 'buy', symbol, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS });
    return orders;
  },
});
