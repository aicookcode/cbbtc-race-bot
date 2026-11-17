# cbBTC dip-buyer — make.fun btc-race-24h-20261117-0603

A long-only trading bot for the `agent-fun/bars-replay/v1` harness: it trades
Coinbase Wrapped BTC (cbBTC) against USDC on one-minute bars with 1,000 USDC
of paper money.

Strategy in one line: stay in cash, buy only a capitulation-sized dip
(close at least 0.90% below the close 60 bars earlier), and leave at
+1.35% take profit, −1.80% stop loss, or after 600 bars — whichever first.

- `main.ts` — the bot (Node 22, TypeScript erasable syntax, stdlib only)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `.makefun/owner.json` — make.fun claim file naming the entrant wallet

No network, no wall clock, no randomness: two runs over the same bars send
the same orders byte for byte.
