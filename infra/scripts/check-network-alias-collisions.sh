#!/bin/sh
# Detects the class of bug that caused the 2026-09-11 production incident:
# two containers from *different* docker-compose projects (e.g. prod's
# sovlend-web-1 and beta's web-1) sharing a network and both answering to the
# same Docker embedded-DNS alias (e.g. "web"), because their compose service
# keys collided. When that happens, reverse proxies that resolve the alias
# (Caddy's `reverse_proxy web:3000`) round-robin across both containers,
# silently misrouting traffic between environments.
#
# Run this periodically (see crontab below). It exits non-zero and prints a
# CRITICAL line per collision if any alias on any docker network is claimed
# by containers belonging to more than one compose project. Exits 0 (silent
# unless -v is passed) when everything is healthy.
set -eu

verbose=0
[ "${1:-}" = "-v" ] && verbose=1

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

networks=$(docker network ls --format '{{.Name}}' --filter driver=bridge)
found_collision=0

for net in $networks; do
  containers=$(docker network inspect "$net" --format '{{range $id, $c := .Containers}}{{$id}} {{end}}' 2>/dev/null || true)
  [ -z "$containers" ] && continue

  # alias -> "containerName:project" list, newline separated, per alias
  alias_map=$(mktemp)
  for cid in $containers; do
    name=$(docker inspect "$cid" --format '{{.Name}}' 2>/dev/null | sed 's#^/##') || continue
    project=$(docker inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo "")
    aliases=$(docker inspect "$cid" --format "{{range \$n, \$e := .NetworkSettings.Networks}}{{if eq \$n \"$net\"}}{{range \$e.Aliases}}{{.}} {{end}}{{end}}{{end}}" 2>/dev/null || true)
    for alias in $aliases; do
      # skip the container's own random hostname-style alias (12-hex-char id), only care about human-chosen aliases
      echo "$alias|$name|${project:-<no-compose-project>}" >> "$alias_map"
    done
  done

  for alias in $(cut -d'|' -f1 "$alias_map" | sort -u); do
    projects=$(awk -F'|' -v a="$alias" '$1==a {print $3}' "$alias_map" | sort -u)
    project_count=$(echo "$projects" | grep -c . || true)
    if [ "$project_count" -gt 1 ]; then
      found_collision=1
      log "CRITICAL alias '$alias' on network '$net' is claimed by containers from $project_count different compose projects: $(echo "$projects" | tr '\n' ',' | sed 's/,$//')"
      awk -F'|' -v a="$alias" '$1==a {print "  -> " $2 " (project: " $3 ")"}' "$alias_map"
    elif [ "$verbose" = 1 ]; then
      log "ok alias '$alias' on network '$net' (project: $projects)"
    fi
  done
  rm -f "$alias_map"
done

if [ "$found_collision" = 1 ]; then
  log "RESULT: network alias collision detected -- see CRITICAL lines above"
  exit 1
fi
[ "$verbose" = 1 ] && log "RESULT: no network alias collisions detected"
exit 0
