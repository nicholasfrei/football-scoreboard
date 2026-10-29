#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${SCOREBOARD_REPOSITORY:-nicholasfrei/football-scoreboard}"
APP_HOME="${SCOREBOARD_APP_HOME:-/home/nick/apps/football-scoreboard}"
SERVICE="${SCOREBOARD_SERVICE:-football-scoreboard.service}"

release_json="$(curl -fsSL "https://api.github.com/repos/${REPOSITORY}/releases/latest")"
tag="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' <<<"$release_json")"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo "Refusing unexpected release tag: $tag" >&2
  exit 1
}

mkdir -p "$APP_HOME/releases"
release_dir="$APP_HOME/releases/$tag"
if [[ ! -d "$release_dir" ]]; then
  temporary_dir="$APP_HOME/releases/.${tag}.tmp.$$"
  trap 'rm -rf "$temporary_dir"' EXIT
  git clone --quiet --depth 1 --branch "$tag" \
    "https://github.com/${REPOSITORY}.git" "$temporary_dir"
  mv "$temporary_dir" "$release_dir"
  trap - EXIT
fi

old_target="$(readlink -f "$APP_HOME/current" 2>/dev/null || true)"
if [[ "$old_target" == "$release_dir" ]]; then
  echo "Already running release $tag"
  exit 0
fi

ln -s "$release_dir" "$APP_HOME/current.next"
mv -Tf "$APP_HOME/current.next" "$APP_HOME/current"
if ! systemctl restart "$SERVICE"; then
  echo "Service restart failed for $tag; restoring previous release" >&2
  if [[ -n "$old_target" ]]; then
    ln -s "$old_target" "$APP_HOME/current.rollback"
    mv -Tf "$APP_HOME/current.rollback" "$APP_HOME/current"
    systemctl restart "$SERVICE" || true
  fi
  exit 1
fi

for attempt in {1..15}; do
  if curl -fsS --max-time 2 http://127.0.0.1:4173/ >/dev/null; then
    echo "Updated scoreboard to $tag"
    exit 0
  fi
  sleep 2
done

echo "Health check failed for $tag; restoring previous release" >&2
if [[ -n "$old_target" ]]; then
  ln -s "$old_target" "$APP_HOME/current.rollback"
  mv -Tf "$APP_HOME/current.rollback" "$APP_HOME/current"
  systemctl restart "$SERVICE" || true
fi
exit 1
