#!/bin/bash
# Build the committed public branch on its own, the way Update Margin does (scripts/mac/update.sh): a fresh temporary folder holding only
# `git archive public`, node_modules cloned in, and an empty data folder. It fails when committed code needs a file that isn't committed
# (untracked, .gitignore, .git/info/exclude) or anything outside the repo. Commit first: this builds the branch, not the working tree.
#   scripts/check-clean-build.sh [branch]      (default: public)
set -euo pipefail
cd "$(dirname "$0")/.."
branch="${1:-public}"
sha="$(git rev-parse --short "$branch")"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/margin-clean-build.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/src" "$tmp/data"
git archive "$branch" | tar -x -C "$tmp/src"
cp -cR node_modules "$tmp/src/node_modules" 2>/dev/null || cp -R node_modules "$tmp/src/node_modules"
echo "Building $branch at $sha in $tmp/src with an empty data folder"
if (cd "$tmp/src" && NODE_ENV=production MARGIN_DATA_DIR="$tmp/data" node node_modules/next/dist/bin/next build) > "$tmp/build.log" 2>&1; then
  [ -z "$(ls -A "$tmp/data")" ] || echo "Note: the build wrote into its data folder: $(ls -A "$tmp/data" | tr '\n' ' ')"
  echo "Clean build passed ($branch at $sha)."
else
  tail -40 "$tmp/build.log"
  echo "Clean build FAILED ($branch at $sha)."
  exit 1
fi
