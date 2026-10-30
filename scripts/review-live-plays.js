import { readFile } from "node:fs/promises";

const path = process.argv[2] ?? "logs/espn-gb-2026-10-29.jsonl";
const rows = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const seen = new Map();
let added = 0;
let revised = 0;
let failures = 0;
for (const row of rows) {
  if (row.error) {
    failures++;
    console.log(`${row.fetchedAt} poll ${row.poll}: ${row.error}`);
    continue;
  }
  for (const play of row.plays) {
    const identity = [play.sequenceNumber, play.type, play.text?.trim(), play.scoringPlay,
      play.scoringType, play.penalty, play.start, play.end];
    const previous = seen.get(play.id);
    if (previous && JSON.stringify(previous.identity) === JSON.stringify(identity)) continue;
    if (previous) {
      revised++;
      const before = previous.play.text?.trim() ?? "";
      const after = play.text?.trim() ?? "";
      console.log(`${row.fetchedAt} REVISED ${play.id} seq=${play.sequenceNumber} (${previous.at}):`);
      if (before !== after) console.log(`  before: ${before}\n  after:  ${after}`);
      else console.log(`  ${play.type}: structured penalty/spot/scoring metadata changed`);
    } else if (row !== rows[0]) {
      added++;
      console.log(`${row.fetchedAt} NEW ${play.id} seq=${play.sequenceNumber} ${play.type}: ${play.text?.trim() ?? ""}`);
    }
    seen.set(play.id, { identity, play, at: row.fetchedAt });
  }
}
console.log(`\n${rows.length} polls; ${added} new plays, ${revised} revisions, ${failures} failed requests.`);
