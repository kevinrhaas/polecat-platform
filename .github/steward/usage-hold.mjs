// USAGE HOLD — what the loop does when the Claude account is out of usage.
//
// On 2026-11-25 the account behind CLAUDE_CODE_OAUTH_TOKEN hit its WEEKLY
// limit. From 21:54 UTC to 01:47 UTC every "Steward improve — chicago [k/5]"
// run got `rate_limit_event … status: rejected · seven_day`, printed "You've
// hit your weekly limit · resets 4am (UTC)" and failed inside a minute. A
// failed run does not kick a refill, but the 10-minute cron does, and each tick
// saw five empty slots and filled all five: about 120 red runs in four hours,
// every one of them certain to fail, until the owner switched the roster off
// by hand. The limit then reset at 04:00 UTC with the lane still off, so the
// loop sat stopped for another fifteen hours with nothing wrong.
//
// The fix is a hold with an end time. The FIRST run that is refused writes the
// repository variable STEWARD_HOLD_CLAUDE ("<reset ISO> <why>") from the
// rate-limit event itself (stream-log.mjs calls writeHold). The scheduler
// (dispatch-lanes.mjs) reads it each tick: until the reset time it starts no
// Claude lane at all and says so in one line; after it, it deletes the
// variable and the lane fills as usual on that same tick. Nobody has to touch
// the roster either way.
//
// A refusal while extra usage is allowed and in use is not a stop (the CLI
// carries on), so it writes no hold. A hold with no reset time is never
// written: a hold that cannot end would be the same stuck loop by another road.
import { execFileSync } from 'node:child_process';

export const HOLD_VAR = 'STEWARD_HOLD_CLAUDE';

// The per-app hold the janitor's batch merge writes (batch-merge.mjs): same value
// format, read the same way, scoped to one app's lanes.
export const appHoldVar = app => 'STEWARD_HOLD_' + String(app).toUpperCase().replace(/[^A-Z0-9]/g, '_');

// The hold value for a `rate_limit_event`'s rate_limit_info, or null when the
// event does not stop the agent.
export function holdFromLimit(info, runId = '') {
  if (!info || info.status !== 'rejected') return null;
  if (info.isUsingOverage === true || info.overageStatus === 'allowed') return null;
  const at = Number(info.resetsAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  const kind = { seven_day: 'weekly', five_hour: '5-hour' }[info.rateLimitType] || info.rateLimitType || 'usage';
  return `${new Date(at * 1000).toISOString()} Claude ${kind} limit reached${runId ? ` (run ${runId})` : ''}`;
}

// { until: Date, why } while the hold stands; { expired: true } once its
// reset time has passed; null for no hold or an unreadable one (fail OPEN: a
// garbled variable must never stop the loop for good).
export function readHold(value, now = new Date()) {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s*(.*)$/.exec(String(value || '').trim());
  if (!m) return null;
  const until = new Date(m[1]);
  if (Number.isNaN(until.getTime())) return null;
  // A minute's grace past the reset, so the first run after it is not refused
  // by a clock a few seconds behind the account's.
  if (now.getTime() >= until.getTime() + 60 * 1000) return { expired: true, until, why: m[2] };
  return { until, why: m[2] };
}

// Write (or move) the hold. Never throws: the run is already failing on the
// limit, and a missing variable only costs the old behaviour.
export function writeHold(value, { repo = process.env.GITHUB_REPOSITORY, gh = 'gh' } = {}) {
  if (!value || !repo) return false;
  const run = args => execFileSync(gh, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  try { run(['api', '--method', 'PATCH', `repos/${repo}/actions/variables/${HOLD_VAR}`, '-f', `name=${HOLD_VAR}`, '-f', `value=${value}`]); return true; } catch { /* not there yet */ }
  try { run(['api', '--method', 'POST', `repos/${repo}/actions/variables`, '-f', `name=${HOLD_VAR}`, '-f', `value=${value}`]); return true; } catch { return false; }
}

if (process.argv[2] === '--self-test') {
  const assert = (await import('node:assert/strict')).default;
  const refused = { status: 'rejected', resetsAt: 1795665600, rateLimitType: 'seven_day', overageStatus: 'rejected', isUsingOverage: false };
  assert.equal(holdFromLimit(refused, '45738037975'), '2026-11-26T04:00:00.000Z Claude weekly limit reached (run 45738037975)');
  assert.equal(holdFromLimit({ ...refused, status: 'allowed_warning' }), null);
  assert.equal(holdFromLimit({ ...refused, isUsingOverage: true }), null);
  assert.equal(holdFromLimit({ ...refused, resetsAt: undefined }), null);
  assert.match(holdFromLimit({ ...refused, rateLimitType: 'five_hour' }), /5-hour limit/);
  const v = holdFromLimit(refused);
  assert.equal(readHold(v, new Date('2026-11-26T01:50:00Z')).until.toISOString(), '2026-11-26T04:00:00.000Z');
  assert.equal(readHold(v, new Date('2026-11-26T04:00:30Z')).expired, undefined);
  assert.equal(readHold(v, new Date('2026-11-26T04:01:00Z')).expired, true);
  assert.equal(readHold('', new Date()), null);
  assert.equal(readHold('soon, probably', new Date()), null);
  console.log('usage-hold self-test: ok');
}
