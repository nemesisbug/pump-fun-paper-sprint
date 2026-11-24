# Tide Rider — Pump.fun Paper Sprint

[![make.fun](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/nemesisbug/pump-fun-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/nemesisbug/pump-fun-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A paper-trading bot for the [Pump.fun Paper Sprint](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) bounty on make.fun: one program (`main.ts`, Node 22) that trades pump.fun bonding curves on a replay, ranked by net PnL. No real money, no entry fee.

## The idea

On pump.fun almost every coin dies, but the few that survive to high real SOL keep running. On the kit's dev window, coins that reached 40 SOL of real reserves peaked at a median **2.09x** the price they had at 40 SOL, and the *fast* risers — coins that ran from 5 to 25 SOL within 100 slots — were up a median **86%** another 200 slots later. Slow climbers stalled.

**Lane A — the graduation rider.** Buys a coin as its real SOL reserve climbs fast toward graduation (~85 SOL): entry when real SOL first crosses 25 SOL within 400 slots of first reaching 5 SOL, with rising price and fresh buyers. Adds one tranche per higher real-SOL rung (40 / 55 / 70) but only into proven strength (position already up 25%). Exits on a tight 6% stop, an 8% trailing stop once up 5%, a stall, or a time limit. The house momentum pilot does the opposite — it caps entries at 60 SOL and never rides a curve to completion.

**Lane B — the breadth scalper.** Tiny (0.03 SOL) quick trades on younger coins with a hot tape: 12% take profit, 12% stop, short hold. Its job is the guardrail — at least 20 distinct coins with ≥ 0.01 SOL round trips — plus a little extra PnL.

## Local backtest (kit dev window, 24h of pump.fun chain data)

| Slice | Net PnL | Fills | Coins | Max drawdown |
| --- | --- | --- | --- | --- |
| part 1 of 3 | +0.089 SOL | 353 | 176 | 3.2% |
| part 2 of 3 | −0.207 SOL | 415 | 207 | 3.2% |
| part 3 of 3 | −0.034 SOL | 234 | 113 | 1.9% |
| full 24h | −0.149 SOL | 1006 | 498 | 4.4% |

For comparison on the same full window, the house pilots score: momentum −9.39 SOL, reversion −4.02 SOL, sniper −0.49 SOL. The dev window is one sample and the final window is fresh 6h data, so these numbers are a robustness check, not a forecast. Deterministic by construction: no clock, no randomness, no I/O — the two graded executions produce byte-identical action logs.

## Layout

- `main.ts` — entrypoint: runs the strategy through the replay shim.
- `strategy.ts` — the two-lane strategy (all parameters in `DEFAULT_PARAMS`).
- `vendor/makefun-bot.ts` — the kit's replay-protocol shim, vendored unchanged.

## License

MIT — see [LICENSE](LICENSE).
