#!/usr/bin/env bash
# Status line: model + context window usage bar.
input=$(cat)

MODEL=$(jq -r '.model.display_name // "Claude"' <<<"$input")
PCT=$(jq -r '.context_window.used_percentage // 0' <<<"$input" | cut -d. -f1)
SIZE=$(jq -r '.context_window.context_window_size // 0' <<<"$input")
USED=$(jq -r '(.context_window.current_usage // {}) | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))' <<<"$input")

# Green under 50%, yellow under 80%, red above.
if   [ "$PCT" -ge 80 ]; then COLOR='\033[31m'
elif [ "$PCT" -ge 50 ]; then COLOR='\033[33m'
else                         COLOR='\033[32m'
fi
RESET='\033[0m'

FILLED=$(( PCT / 10 )); [ "$FILLED" -gt 10 ] && FILLED=10
BAR=''
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [ "$i" -le "$FILLED" ]; then BAR+='▓'; else BAR+='░'; fi
done

fmt_k() { awk -v n="$1" 'BEGIN { if (n >= 1000000) printf "%.1fM", n/1000000; else printf "%dk", n/1000 }'; }

printf "[%s] ${COLOR}%s %s%%${RESET} (%s / %s)\n" "$MODEL" "$BAR" "$PCT" "$(fmt_k "$USED")" "$(fmt_k "$SIZE")"
