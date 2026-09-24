/**
 * A fresh caller id for each tournament a test creates.
 *
 * Creation is throttled per caller, and a call with no id lands in one shared
 * bucket. A full integration run creates close to that bucket's hourly limit on
 * its own, so a second run inside the hour would fail on the throttle rather
 * than on anything it was testing. A distinct id per create keeps every run
 * independent; the site-wide ceiling still applies, which is the limit a
 * shared test deployment should be held to.
 */
const RUN_ID = crypto.randomUUID().slice(0, 8);
let created = 0;

export function createSource(): string {
  created += 1;
  return `integration-${RUN_ID}-${created}`;
}
