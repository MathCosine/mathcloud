/**
 * Saving a round's answer key from the Problems page.
 *
 * It goes through saveRound like every other change. One wrinkle when
 * connected: the database keeps one problem per number in a round, and checks
 * that row by row while it saves. Renumbering (or moving a Guts problem to
 * another set) can hand a number to one problem before the problem that had it
 * has moved on, and the save would be refused. When that would happen, the
 * problems that move are first parked on numbers nobody uses, in one request.
 */
import type { Problem } from './model';
import { needsParking } from './problem-grid';
import { saveRound } from './actions';
import { getDB, REMOTE } from './store';
import { client } from './remote/client';
import { reloadSoon, reportError } from './remote/live';

let chain: Promise<unknown> = Promise.resolve();

/** Save a round's problems. Resolves once the change is in the store (and on its way to the database). */
export function saveKey(roundId: string, problems: Problem[]): Promise<void> {
  const round = getDB().contests.flatMap((c) => c.rounds).find((r) => r.id === roundId);
  if (!round) return Promise.resolve();
  const park = REMOTE ? needsParking(round.problems, problems) : [];
  if (!park.length) {
    saveRound(roundId, { problems });
    return Promise.resolve();
  }
  const run = chain.then(async () => {
    const base = -1 - (Date.now() % 1_000_000) * 100;
    const { error } = await client().from('problems').upsert(park.map((p, i) => ({
      id: p.id, round_id: roundId, number: base - i, set_no: p.set ?? null, body: p.text, answer_type: p.answerType, points: p.points,
    })));
    if (error) {
      reportError('Problems not saved', error);
      reloadSoon(600);
      return;
    }
    saveRound(roundId, { problems });
  });
  chain = run.catch(() => undefined);
  return run;
}
