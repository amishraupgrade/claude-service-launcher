#!/bin/bash
# Pulls open PRs from GitHub into review-board/out/<repo>.json, one file per repo,
# in the shape the Review Board artifact stores. Writing to the artifact is a separate step.
#
# Core repos: Credify repos starting with hi- or home-, or containing "merchant"; every PR is kept.
# Common repos: any other repo where a login listed in authors.txt has an open PR; only those
# authors' PRs are kept. Never included: bnpl, flexpay, hi-decision-engine, chargeoff, and the
# names in ignore-repos.txt. Archived repos are skipped.
set -u
cd "$(dirname "$0")" || exit 1
mkdir -p out
rm -f out/*.json out/*.err out/*.raw out/repos.txt

NOW=$(($(date +%s) * 1000))
FIELDS=number,title,author,isDraft,reviewDecision,createdAt,updatedAt,additions,deletions,changedFiles,reviewRequests,labels,statusCheckRollup

excluded() {
  case "$(echo "$1" | tr 'A-Z' 'a-z')" in
    bnpl*|flexpay*|hi-decision-engine*|*chargeoff*) return 0 ;;
  esac
  return 1
}

# Logins from authors.txt as a lowercase JSON array.
AUTHORS=$(grep -v '^[[:space:]]*\(#\|$\)' authors.txt 2>/dev/null | tr -d '\r ' | tr 'A-Z' 'a-z')
if [ -n "$AUTHORS" ]; then
  ONLY=$(printf '%s\n' $AUTHORS | jq -R . | jq -s -c .)
else
  ONLY='[]'
fi

# Fetches one repo into out/<repo>.json. $1 repo, $2 common (true/false), $3 author filter JSON.
fetch_repo() {
  local r=$1 common=$2 only=$3
  if gh pr list --repo "Credify/$r" --state open --limit 100 --json "$FIELDS" > "out/$r.raw" 2> "out/$r.err" \
     && jq --arg r "$r" --argjson t "$NOW" --argjson common "$common" --argjson only "$only" -f transform.jq "out/$r.raw" > "out/$r.json"; then
    rm -f "out/$r.raw" "out/$r.err"
    return 0
  fi
  rm -f "out/$r.json" "out/$r.raw"
  return 1
}

gh repo list Credify --limit 1000 --no-archived --json name --jq '.[].name' > out/all-repos.txt \
  || { echo "ERROR: could not list repos"; exit 2; }

# Core repos.
: > out/core.txt
while read -r n; do
  l=$(echo "$n" | tr 'A-Z' 'a-z')
  case "$l" in hi-*|home-*|*merchant*) excluded "$n" || echo "$n" >> out/core.txt ;; esac
done < out/all-repos.txt

# Common repos: where a tracked author has an open PR.
: > out/common-candidates.txt
for a in $AUTHORS; do
  gh search prs --owner Credify --author "$a" --state open --limit 200 --json repository --jq '.[].repository.name' 2>/dev/null >> out/common-candidates.txt
done
: > out/common.txt
sort -u out/common-candidates.txt | while read -r n; do
  [ -z "$n" ] && continue
  grep -qxF "$n" out/core.txt && continue
  excluded "$n" && continue
  grep -v '^[[:space:]]*\(#\|$\)' ignore-repos.txt 2>/dev/null | grep -qxF "$n" && continue
  grep -qxF "$n" out/all-repos.txt || continue
  echo "$n" >> out/common.txt
done

# Fetch up to 8 repos at a time. Failures are recorded in out/failed.txt.
: > out/failed.txt
throttle() { while [ "$(jobs -r | wc -l | tr -d ' ')" -ge 8 ]; do sleep 0.2; done; }

for r in $(cat out/core.txt); do
  throttle
  ( fetch_repo "$r" false '[]' || echo "$r" >> out/failed.txt ) &
done
for r in $(cat out/common.txt); do
  throttle
  ( fetch_repo "$r" true "$ONLY" || echo "$r" >> out/failed.txt ) &
done
wait

# A common repo is kept only if a tracked author still has a reviewable PR in it.
: > out/common-kept.txt
for r in $(cat out/common.txt); do
  [ -f "out/$r.json" ] || continue
  if [ "$(jq '.prs | length' "out/$r.json")" -gt 0 ]; then
    echo "$r" >> out/common-kept.txt
  else
    rm -f "out/$r.json"
  fi
done
FAILED=$(tr '\n' ' ' < out/failed.txt)
rm -f out/failed.txt

cat out/core.txt out/common-kept.txt | sort > out/repos.txt
rm -f out/all-repos.txt out/common-candidates.txt out/common.txt

PRS=$(cat out/*.json 2>/dev/null | jq -s '[.[] | select(has("prs")) | .prs[]] | length')
echo "repos=$(wc -l < out/repos.txt | tr -d ' ') core=$(wc -l < out/core.txt | tr -d ' ') common=$(wc -l < out/common-kept.txt | tr -d ' ') failed=$(echo $FAILED | wc -w | tr -d ' ') prs=$PRS"
[ -n "$FAILED" ] && echo "FAILED:$FAILED"
exit 0
