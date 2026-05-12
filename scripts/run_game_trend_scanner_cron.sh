#!/usr/bin/env bash
set -euo pipefail

ROOT="/root/clawd/projects/google_keywords"
ENV_FILE="/root/.config/google_keywords/precompute.env"
LOG_DIR="/tmp"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/game_trend_scanner_${STAMP}.log"
REPORT_FILE="$LOG_DIR/game_trend_report_$(date -u +%F).txt"
LOCK_FILE="/tmp/google_keywords_game_trend_scanner.lock"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$LOCK_FILE" ]]; then
  old_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "status=skipped"
    echo "reason=another scanner is still running pid=$old_pid"
    echo "log=$LOG_FILE"
    exit 0
  fi
fi

echo $$ > "$LOCK_FILE"
cleanup() {
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT

cd "$ROOT"

# Keep the daily cron comfortably below the OpenClaw job timeout. The scanner is
# sequential and each 5-keyword trends batch can take ~60-120s plus 90d/SERP.
# A 20-keyword budget still samples all active sources via select_games_to_check.
MAX_KEYWORDS="${GAME_TREND_MAX_KEYWORDS:-20}"
MAX_SOURCES="${GAME_TREND_MAX_SOURCES:-5}"
TIMEOUT_SECONDS="${GAME_TREND_TIMEOUT_SECONDS:-780}"

set +e
timeout "$TIMEOUT_SECONDS" python3 scripts/game_trend_scanner.py \
  --max-keywords "$MAX_KEYWORDS" \
  --max-sources "$MAX_SOURCES" \
  > "$LOG_FILE" 2>&1
code=$?
set -e

python3 - "$LOG_FILE" "$REPORT_FILE" "$code" "$MAX_KEYWORDS" "$MAX_SOURCES" <<'PY'
import json
import re
import sys
from pathlib import Path

log_path = Path(sys.argv[1])
report_path = Path(sys.argv[2])
code = int(sys.argv[3])
max_keywords = sys.argv[4]
max_sources = sys.argv[5]
text = log_path.read_text(errors='replace') if log_path.exists() else ''

summary = {
    'status': 'ok' if code == 0 else ('timeout' if code == 124 else 'error'),
    'exit_code': code,
    'log': str(log_path),
    'max_keywords': max_keywords,
    'max_sources': max_sources,
}

patterns = {
    'data_source': r'Data source:\s*(.+)',
    'total_new_games': r'Total new games found:\s*(\d+)',
    'trend_checked': r'Trend-checked:\s*(\d+)',
    'hot': r'🔥 Hot:\s*(\d+)',
    'rising': r'📈 Rising:\s*(\d+)',
    'niche': r'🎯 Niche:\s*(\d+)',
    'skip': r'⏭️ Skip:\s*(\d+)',
}
for key, pattern in patterns.items():
    matches = re.findall(pattern, text)
    if matches:
        value = matches[-1].strip()
        summary[key] = int(value) if value.isdigit() else value

batch_matches = re.findall(r'📈 Batch (\d+)/(\d+)', text)
if batch_matches:
    summary['last_batch'] = f"{batch_matches[-1][0]}/{batch_matches[-1][1]}"

recommended = []
if '__RECOMMENDED_JSON__' in text:
    tail = text.split('__RECOMMENDED_JSON__', 1)[1].strip().splitlines()
    if tail:
        try:
            recommended = json.loads(tail[0])
        except Exception:
            recommended = []
summary['recommended_count'] = len(recommended)

lines = [
    '🎮 游戏关键词扫描结果',
    f"status={summary['status']} exit_code={code}",
    f"log={log_path}",
    f"budget=max_keywords:{max_keywords} max_sources:{max_sources}",
]
if 'data_source' in summary:
    lines.append(f"data_source={summary['data_source']}")
if 'total_new_games' in summary:
    lines.append(f"total_new_games={summary['total_new_games']}")
if 'trend_checked' in summary:
    lines.append(f"trend_checked={summary['trend_checked']}")
if 'last_batch' in summary:
    lines.append(f"last_batch={summary['last_batch']}")
lines.append(
    f"hot={summary.get('hot', 0)} rising={summary.get('rising', 0)} "
    f"niche={summary.get('niche', 0)} skip={summary.get('skip', 0)} recommended={len(recommended)}"
)
if recommended:
    lines.append('recommended:')
    for item in recommended[:8]:
        lines.append(f"- {item.get('recommendation','?')} {item.get('keyword')} ratio={item.get('ratio')} src={item.get('source')}")
else:
    lines.append('recommended: none')

# Include the last useful line if the run failed before summary.
if summary['status'] != 'ok':
    useful = [ln for ln in text.splitlines() if ln.strip()][-12:]
    if useful:
        lines.append('tail:')
        lines.extend(useful)

report = '\n'.join(lines) + '\n'
report_path.write_text(report)
print(report, end='')
PY

exit "$code"
