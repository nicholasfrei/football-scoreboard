#!/usr/bin/env bash
# Capture 60 ESPN game-summary snapshots (~10 minutes) as newline-delimited JSON.
set -uo pipefail

event_id="${1:-401873023}"
log="${2:-logs/espn-gb-2026-10-29.jsonl}"
polls="${3:-60}"
interval="${4:-10}"
mkdir -p "$(dirname "$log")"
url="https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${event_id}"

for ((poll = 1; poll <= polls; poll++)); do
  started_at="$(date +%s)"
  fetched_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if ! curl -fsS --max-time 10 "$url" | jq -c --arg fetchedAt "$fetched_at" --argjson poll "$poll" '
    def play: {id, sequenceNumber, period: .period.number, clock: .clock.displayValue,
      wallclock, type: .type.text, text, scoringPlay, scoringType: .scoringType.name,
      isPenalty, penalty, start, end};
    ([.drives.previous[]?, .drives.current?] | map(select(. != null) | .plays[]?)) as $all |
    # The same ID may occur in previous and current drives; keep the latter revision.
    ($all | reduce .[] as $p ({}; .[$p.id] = $p) | [.[]]
      | sort_by(.period.number // 0, (.sequenceNumber // "0" | tonumber), .wallclock // "", .id)) as $ordered |
    {fetchedAt: $fetchedAt, poll: $poll, gameId: .header.id,
      status: .header.competitions[0].status, situation,
      latest: ($ordered[-1] | if . == null then null else play end),
      plays: ($ordered | map(play)),
      scoringPlays: [.scoringPlays[]? | {id, text, teamId: .team.id, scoringType: .scoringType.name}]}
  ' >> "$log"; then
    printf '{"fetchedAt":"%s","poll":%s,"error":"curl or jq failed"}\n' "$fetched_at" "$poll" >> "$log"
  fi
  printf 'Poll %s/%s at %s → %s\n' "$poll" "$polls" "$fetched_at" "$log"
  if ((poll < polls)); then
    remaining=$((interval - ($(date +%s) - started_at)))
    if ((remaining > 0)); then sleep "$remaining"; fi
  fi
done
printf 'Capture complete: %s\n' "$log"
