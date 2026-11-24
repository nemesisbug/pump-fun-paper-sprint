// Tide Rider: a graduation-proximity rider with a breadth scalper for the
// pump.fun paper sprint. See strategy.ts for the idea and the numbers behind
// it. Run by the grader as `node /bot/main.ts` (Node 22 strips the types; no
// build, no install). The SDK shim is vendored beside it
// (vendor/makefun-bot.ts is a copy of the kit's sdk/ts/makefun-bot.ts).
// The bot answers one reply per batch and never reads the clock, the
// environment or Math.random, so the two graded runs agree byte for byte.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
