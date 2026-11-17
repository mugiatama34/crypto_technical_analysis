#!/bin/bash
# Bybit DEMO köprüsünün yerel turu: depoyu çek → bir tur → demo.json değiştiyse commit + push. launchd 15 dakikada bir çağırır.
# Kullanım: run.sh <depo klonu> [dal]. Klon iCloud dışında olmalı (arka plan görevi iCloud klasörüne erişemeyebilir).
set -u
REPO="${1:?depo yolu}"; BRANCH="${2:-claude/awesome-heisenberg-mmuyod}"
export PATH="$(dirname "$(command -v node 2>/dev/null || echo /usr/local/bin/node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
[ -n "${NODE_BIN:-}" ] && export PATH="$(dirname "$NODE_BIN"):$PATH"
LOCK="$REPO/.git/demo-runner.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # 20 dakikadan eski kilit = yarım kalmış tur
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
cd "$REPO" || exit 1
git fetch -q origin "$BRANCH" && git reset -q --hard "origin/$BRANCH" || { echo "$(date -u +%FT%TZ) git çekilemedi"; exit 1; }
node bot/exchange/local.mjs; RC=$?
if [ -n "$(git status --porcelain docs/signals/demo.json 2>/dev/null)" ]; then
  git add docs/signals/demo.json
  git -c user.name="demo-runner" -c user.email="demo-runner@users.noreply.github.com" commit -q -m "demo: Bybit demo kaydı güncellemesi (yerel)"
  for i in 1 2 3; do
    git pull -q --rebase origin "$BRANCH" && git push -q origin "HEAD:$BRANCH" && break
    sleep $((i * 5))
  done
fi
exit $RC
