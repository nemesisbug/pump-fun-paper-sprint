// Tide Rider: a graduation-proximity rider with a breadth scalper, for
// agent-fun/replay/v2 (pump.fun bonding curves).
//
// Two lanes, one idea: on pump.fun almost every coin dies, but the few that
// survive to high real SOL keep running. The dev window says so: coins that
// reached 40 SOL of real reserves peaked at a median 2.09x the price they had
// at 40 SOL (p25 1.10x), and 41 of the 47 that went on to 60 SOL were up more
// than 10% from their 40 SOL price. The fast risers are the best of them:
// coins that ran from 5 to 25 SOL of real reserves within 100 slots were up
// a median 86% another 200 slots later (18 of 27 up more than 15%), while
// slow climbers stalled. So the main lane buys coins as their real SOL
// reserve climbs fast toward graduation (~85 SOL) and rides the final leg,
// adding only into proven strength and cutting out on a tight stop, a tight
// trailing stop, or a stall. Tight exits matter: on the dev window a 20%
// trailing stop let the winners round-trip into gap-downs that erased them,
// while a 6% stop / 8% trail kept the 24h drawdown to 4.4% and the net PnL
// near breakeven. The house momentum pilot does the opposite: it caps
// entries at 60 SOL real and never rides a curve to completion.
//
// The second lane is a breadth scalper: tiny quick trades on younger coins
// with strong rising flow. Its job is the guardrail (at least 20 distinct
// coins with >= 0.01 SOL round trips) plus a little extra PnL; each trade is
// small enough that a loss barely registers.
//
// Everything here is a pure function of the batches the harness sends: no
// clock, no randomness, no I/O, so the two graded executions produce
// byte-identical action logs. Iteration is over insertion-ordered maps fed by
// the batch stream, and over alphabetically sorted mint lists where a set is
// scanned, so the order is deterministic.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Lane A: enter when real SOL first crosses this (SOL). */
  riderEnterRqSol: number;
  /** Lane A: never enter above this real SOL (SOL). */
  riderMaxRqSol: number;
  /** Lane A: price now must be at least this far above the price `riderMomSlots` ago. */
  riderMom: number;
  riderMomSlots: number;
  /** Lane A: net SOL bought over the last `riderFlowSlots` slots must beat this. */
  riderFlowSol: number;
  riderFlowSlots: number;
  /** Lane A: distinct buyers over the last `riderFlowSlots` slots, at least. */
  riderMinBuyers: number;
  /** Lane A: ...and at most (a launch crowded by absurdly many wallets). */
  riderMaxBuyers: number;
  /** Lane A: slots from real SOL first reaching 5 to first reaching the entry rung, at most. */
  riderMaxRiseSlots: number;
  /** Lane A: slots to wait after the crossing before buying: the coin must
   * still hold >= 95% of its crossing price then (filters instant dumps).
   * Tried at 60 and 120 on the dev window: both cost more than they saved
   * (the delay eats the winners' upside), so it defaults to 0 = off. */
  riderConfirmSlots: number;
  /** Lane A: real-SOL rungs at which to add a tranche (SOL). */
  riderAddRungsSol: number[];
  /** Lane A: SOL per buy (first buy and each add). */
  riderTrancheSol: number;
  /** Lane A: most SOL into one coin in total. */
  riderMaxSol: number;
  /** Lane A: most rider positions open at once. */
  riderMaxOpen: number;
  /** Lane A: exit when liquidation value falls to cost * (1 - riderStop). */
  riderStop: number;
  /** Lane A: trailing stop arms once value reaches cost * (1 + riderTrailArm). */
  riderTrailArm: number;
  /** Lane A: exit on a fall of this share from the best value. */
  riderTrail: number;
  /** Lane A: exit when no new price high for this many slots. */
  riderStallSlots: number;
  /** Lane A: exit after holding this many slots regardless. */
  riderMaxHoldSlots: number;
  /** Lane B: real-SOL band for scalps (SOL). */
  scalpMinRqSol: number;
  scalpMaxRqSol: number;
  /** Lane B: price now over the price `scalpMomSlots` ago, at least. */
  scalpMom: number;
  scalpMomSlots: number;
  /** Lane B: distinct buyers over the last `scalpMomSlots` slots, at least. */
  scalpMinBuyers: number;
  /** Lane B: net SOL bought over the last `scalpFlowSlots` slots, at least. */
  scalpFlowSol: number;
  scalpFlowSlots: number;
  /** Lane B: SOL per scalp (one buy per coin). */
  scalpSol: number;
  /** Lane B: most scalp positions open at once. */
  scalpMaxOpen: number;
  /** Lane B: take profit at cost * (1 + scalpTakeProfit). */
  scalpTakeProfit: number;
  /** Lane B: stop at cost * (1 - scalpStop). */
  scalpStop: number;
  /** Lane B: exit after holding this many slots regardless. */
  scalpMaxHoldSlots: number;
  /** Lane B: exit when no new price high for this many slots. */
  scalpStallSlots: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldownSlots: number;
  /** Slippage tolerance on buys (bps); sells always go out at 10000. */
  buySlippageBps: number;
  /** Most new entries per reply. */
  maxEntriesPerBatch: number;
}

export const DEFAULT_PARAMS: Params = {
  riderEnterRqSol: 25,
  riderMaxRqSol: 85,
  riderMom: 0.02,
  riderMomSlots: 40,
  riderFlowSol: 0.2,
  riderFlowSlots: 30,
  riderMinBuyers: 4,
  riderMaxBuyers: 100,
  riderMaxRiseSlots: 400,
  riderConfirmSlots: 0,
  riderAddRungsSol: [40, 55, 70],
  riderTrancheSol: 0.25,
  riderMaxSol: 0.5,
  riderMaxOpen: 3,
  riderStop: 0.06,
  riderTrailArm: 0.05,
  riderTrail: 0.08,
  riderStallSlots: 800,
  riderMaxHoldSlots: 2500,
  scalpMinRqSol: 3,
  scalpMaxRqSol: 25,
  scalpMom: 0.1,
  scalpMomSlots: 40,
  scalpMinBuyers: 4,
  scalpFlowSol: 0.1,
  scalpFlowSlots: 20,
  scalpSol: 0.03,
  scalpMaxOpen: 2,
  scalpTakeProfit: 0.12,
  scalpStop: 0.12,
  scalpMaxHoldSlots: 1000,
  scalpStallSlots: 500,
  cooldownSlots: 600,
  buySlippageBps: 5000,
  maxEntriesPerBatch: 2,
};

const LAMPORTS = 1e9;
const FEE_BPS = 125n;
const BPS = 10_000n;

interface Trade {
  slot: number;
  price: number;
  sol: number;
  buy: boolean;
  user: string;
}

interface Tape {
  created: number | null;
  creator: string | null;
  trades: Trade[];
  /** Last real SOL seen (SOL), for crossing detection. */
  lastRq: number;
  /** Slot real SOL first reached 5 (for the rise-speed filter). */
  rq5Slot: number | null;
  /** Crossing of the entry rung, pending confirmation: slot and price. */
  crossSlot: number | null;
  crossPrice: number;
  /** Highest price seen (for stall detection). */
  highPrice: number;
  highSlot: number;
  /** Times this coin was entered (lane A once, lane B once). */
  riderEntered: boolean;
  scalpEntered: boolean;
  /** Slot until which the coin is ignored after an exit. */
  coolUntil: number;
}

interface Held {
  lane: 'rider' | 'scalp';
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  /** Real-SOL rungs already added at. */
  rungsHit: number[];
  /** A sell is in flight: do not send another. */
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Slot of the highest price seen while held. */
  lastHighSlot: number;
  lastHighPrice: number;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

/**
 * The per-reply buy cap, with a margin: the harness checks it against the
 * reserves shifted by our own earlier flow on the coin, which can sit a
 * little below the recorded ones the SDK keeps.
 */
function buyCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = {
        created: null,
        creator: null,
        trades: [],
        lastRq: 0,
        rq5Slot: null,
        crossSlot: null,
        crossPrice: 0,
        highPrice: 0,
        highSlot: -1,
        riderEntered: false,
        scalpEntered: false,
        coolUntil: -1,
      };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Price of the earliest trade at or after `fromSlot`, else -1. */
  const priceAt = (t: Tape, fromSlot: number): number => {
    for (const tr of t.trades) if (tr.slot >= fromSlot) return tr.price;
    return -1;
  };

  /** Net SOL bought and distinct buyers over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): { net: number; buyers: number } => {
    let net = 0;
    const buyers = new Set<string>();
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
      if (tr.buy) buyers.add(tr.user);
    }
    return { net, buyers: buyers.size };
  };

  const keep = 2000;

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const touched: Pubkey[] = [];
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          t.trades.push({ slot: e.slot, price, sol: Number(e.sol_amount) / LAMPORTS, buy: e.is_buy, user: e.user });
          if (price > t.highPrice) {
            t.highPrice = price;
            t.highSlot = e.slot;
          }
          if (touched[touched.length - 1] !== e.mint && !touched.includes(e.mint)) touched.push(e.mint);
        }
      }
      for (const mint of touched) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      // A position whose sell resolved may need another exit attempt.
      for (const f of batch.fills) {
        const h = held.get(f.mint);
        if (h === undefined) continue;
        if (f.side === 'sell') {
          h.exiting = false;
          if (!state.positions.has(f.mint)) {
            held.delete(f.mint);
            tapeOf(f.mint).coolUntil = now + p.cooldownSlots;
          }
        } else if (f.status === 'filled') {
          h.filled = true;
        } else if (!state.positions.has(f.mint)) {
          // The opening buy never filled: forget the entry.
          let stillPending = false;
          for (const o of state.pending.values()) if (o.order.mint === f.mint) stillPending = true;
          if (!stillPending) held.delete(f.mint);
        }
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingMints = new Set<Pubkey>();
      for (const o of state.pending.values()) pendingMints.add(o.order.mint);

      const valueOf = (mint: Pubkey, tokens: bigint): bigint => {
        const mk = marks.get(mint);
        let vq: bigint;
        let vt: bigint;
        if (mk !== undefined) {
          vq = BigInt(mk.virtual_quote_reserves);
          vt = BigInt(mk.virtual_token_reserves);
        } else {
          const curve = state.curves.get(mint);
          if (curve === undefined) return 0n;
          vq = curve.virtual_quote_reserves;
          vt = curve.virtual_token_reserves;
        }
        const v = sellValue(tokens, vq, vt);
        return v > tx ? v - tx : 0n;
      };

      // 1. Exits and adds on held positions, in mint order (deterministic).
      const heldMints = [...state.positions.keys()].sort();
      for (const mint of heldMints) {
        if (orders.length >= cap) break;
        const h = held.get(mint);
        const pos = state.positions.get(mint)!;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (h === undefined) {
          // A position we do not track (should not happen): sell it whole.
          if (pendingMints.has(mint)) continue;
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
          continue;
        }
        if (h.exiting || pendingMints.has(mint)) continue;
        const t = tapeOf(mint);
        const value = Number(valueOf(mint, pos.token_amount)) / LAMPORTS;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        const price = t.trades.length > 0 ? t.trades[t.trades.length - 1]!.price : 0;
        if (price > h.lastHighPrice) {
          h.lastHighPrice = price;
          h.lastHighSlot = now;
        }
        let exit = false;
        if (h.lane === 'rider') {
          if (value < cost * (1 - p.riderStop)) exit = true;
          if (!exit && h.peakValue >= cost * (1 + p.riderTrailArm) && value < h.peakValue * (1 - p.riderTrail)) exit = true;
          if (!exit && now - h.lastHighSlot > p.riderStallSlots) exit = true;
          if (!exit && now - h.opened > p.riderMaxHoldSlots) exit = true;
        } else {
          const gain = cost > 0 ? value / cost - 1 : 0;          if (gain >= p.scalpTakeProfit) exit = true;
          if (!exit && gain <= -p.scalpStop) exit = true;
          if (!exit && now - h.lastHighSlot > p.scalpStallSlots) exit = true;
          if (!exit && now - h.opened > p.scalpMaxHoldSlots) exit = true;
        }
        if (exit) {
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
          h.exiting = true;
          continue;
        }
        // Lane A adds: one tranche per real-SOL rung crossed, but only into
        // proven strength (the position already up 25%): pyramiding a flat
        // or falling coin doubled the losses on the dev window.
        if (h.lane === 'rider' && h.filled && h.invested < p.riderMaxSol - 0.001 && value >= cost * 1.25) {
          const rq = Number(curve.real_quote_reserves) / LAMPORTS;
          for (const rung of p.riderAddRungsSol) {
            if (h.rungsHit.includes(rung)) continue;
            if (rq < rung) continue;
            h.rungsHit.push(rung);
            let amount = Math.min(p.riderTrancheSol, p.riderMaxSol - h.invested);
            const sizeCap = Number(buyCap(state, mint)) / LAMPORTS;
            if (amount > sizeCap) amount = sizeCap;
            if (amount < 0.01) continue;
            if (state.freeCashLamports() - BigInt(Math.floor(amount * LAMPORTS)) - tx < 0n) continue;
            if (orders.length >= cap) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlippageBps });
            h.invested += amount;
            pendingMints.add(mint);
            break;
          }
        }
      }

      // 2. New entries on coins that traded this slot.
      let entries = 0;
      let free = state.freeCashLamports();
      let ridersOpen = 0;
      let scalpsOpen = 0;
      for (const h of held.values()) {
        if (h.lane === 'rider') ridersOpen++;
        else scalpsOpen++;
      }
      // Note: a buy sent in an earlier batch already has its held entry (set
      // at send time), so pending buys are counted above; nothing extra to do.
      for (const mint of touched) {
        if (orders.length >= cap || entries >= p.maxEntriesPerBatch) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const t = tapes.get(mint)!;
        const rq = Number(curve.real_quote_reserves) / LAMPORTS;
        const prevRq = t.lastRq;
        t.lastRq = rq;
        if (rq >= 5 && t.rq5Slot === null) t.rq5Slot = now;
        if (state.positions.has(mint) || pendingMints.has(mint)) continue;
        if (now < t.coolUntil) continue;
        const price = t.trades.length > 0 ? t.trades[t.trades.length - 1]!.price : 0;
        if (price <= 0) continue;

        // Lane A: the graduation rider. Fires once, when real SOL crosses the
        // entry rung while the tape still shows rising price and fresh buyers.
        // The rise must be fast (5 -> entry rung within riderMaxRiseSlots):
        // on the dev window the fast risers kept running (median +86% 200
        // slots after crossing 25 SOL) while slow climbers stalled. The buy
        // waits riderConfirmSlots after the crossing and needs the coin to
        // still hold 95% of its crossing price: pumps that dump in their
        // first minute never get bought.
        if (!t.riderEntered && rq >= p.riderEnterRqSol && rq <= p.riderMaxRqSol) {
          if (t.crossSlot === null && prevRq < p.riderEnterRqSol) {
            t.crossSlot = now;
            t.crossPrice = price;
          }
          if (t.crossSlot !== null && now - t.crossSlot >= p.riderConfirmSlots) {
            const dumped = price < t.crossPrice * 0.95;
            const oldPrice = priceAt(t, now - p.riderMomSlots);
            const fl = flow(t, now, p.riderFlowSlots);
            const rising = oldPrice > 0 && price >= oldPrice * (1 + p.riderMom);
            const fast = t.rq5Slot !== null && t.crossSlot - t.rq5Slot <= p.riderMaxRiseSlots;
            const signal = !dumped && rising && fast && fl.net >= p.riderFlowSol && fl.buyers >= p.riderMinBuyers && fl.buyers <= p.riderMaxBuyers;
            if (signal && ridersOpen < p.riderMaxOpen) {
              let amount = p.riderTrancheSol;
              const sizeCap = Number(buyCap(state, mint)) / LAMPORTS;
              if (amount > sizeCap) amount = sizeCap;
              if (amount >= 0.01 && free - BigInt(Math.floor(amount * LAMPORTS)) - tx >= 0n) {
                orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlippageBps });
                held.set(mint, {
                  lane: 'rider',
                  opened: now,
                  peakValue: 0,
                  invested: amount,
                  rungsHit: [],
                  exiting: false,
                  filled: false,
                  lastHighSlot: now,
                  lastHighPrice: price,
                });
                t.riderEntered = true;
                free -= BigInt(Math.floor(amount * LAMPORTS)) + tx;
                ridersOpen++;
                entries++;
                pendingMints.add(mint);
                continue;
              }
            }
            // The coin had its confirmation chance and the signal failed (or
            // it dumped): do not retry it as a rider. Blocked only by a full
            // book or short cash, it keeps its chance on later batches.
            if (!signal) t.riderEntered = true;
          }
        }

        // Lane B: the breadth scalper. Young coins with a hot tape.
        if (!t.scalpEntered && rq >= p.scalpMinRqSol && rq < p.scalpMaxRqSol && scalpsOpen < p.scalpMaxOpen) {
          const oldPrice = priceAt(t, now - p.scalpMomSlots);
          if (oldPrice > 0 && price >= oldPrice * (1 + p.scalpMom)) {
            const fl = flow(t, now, p.scalpFlowSlots);
            if (fl.buyers >= p.scalpMinBuyers && fl.net >= p.scalpFlowSol) {
              let amount = p.scalpSol;
              const sizeCap = Number(buyCap(state, mint)) / LAMPORTS;
              if (amount > sizeCap) amount = sizeCap;
              if (amount >= 0.01 && free - BigInt(Math.floor(amount * LAMPORTS)) - tx >= 0n) {
                orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlippageBps });
                held.set(mint, {
                  lane: 'scalp',
                  opened: now,
                  peakValue: 0,
                  invested: amount,
                  rungsHit: [],
                  exiting: false,
                  filled: false,
                  lastHighSlot: now,
                  lastHighPrice: price,
                });
                t.scalpEntered = true;
                free -= BigInt(Math.floor(amount * LAMPORTS)) + tx;
                scalpsOpen++;
                entries++;
                pendingMints.add(mint);
              }
            }
          }
        }
      }
      return orders;
    },
  };
}
