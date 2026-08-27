#!/usr/bin/env bash
#
# Finishes the Grace Lead Manager rollout: the three settings that live in
# Vercel's and Supabase's control planes rather than in this repository.
#
#   1. Promote the current main build to production
#   2. Point the Vercel production branch at main, so future pushes go live
#   3. Set the Supabase Site URL + redirect allow list (fixes the localhost:3000
#      redirect) and turn on leaked-password protection
#
# Run it from anywhere. It reads, writes, then reads back, printing what
# changed — so if an API field name has drifted you see it rather than being
# told success.
#
# Usage:
#   export VERCEL_TOKEN=...          # vercel.com/account/tokens  (scope: jpiercedev's projects)
#   export SUPABASE_ACCESS_TOKEN=... # supabase.com/dashboard/account/tokens
#   bash scripts/finish-rollout.sh
#
# Revoke both tokens afterwards; neither is needed again.

set -euo pipefail

TEAM_ID="team_wEFYFjwI8m1e8zESGyyigswl"
PROJECT_ID="prj_X6jiKLWkjr7y5pc3TxHpw3NsMkkf"
SUPABASE_REF="phhkhvewcclzjkdbjmqw"
SITE_URL="https://grace-force.vercel.app"
GITHUB_REPO="jpiercedev/grace-force"

: "${VERCEL_TOKEN:?set VERCEL_TOKEN first}"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN first}"

v() { curl -sS -w $'\n%{http_code}' -H "Authorization: Bearer ${VERCEL_TOKEN}" "$@"; }
s() { curl -sS -w $'\n%{http_code}' -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" "$@"; }

show() { # <label> <curl-output>
  local label="$1" out="$2" code body
  code="$(printf '%s' "$out" | tail -n1)"
  body="$(printf '%s' "$out" | sed '$d')"
  printf '  %-38s HTTP %s\n' "$label" "$code"
  if [ "${code:0:1}" != "2" ]; then
    printf '    %s\n' "$(printf '%s' "$body" | head -c 500)"
    return 1
  fi
  printf '%s' "$body"
}

echo "==> 1. Find the newest READY deployment of main"
DEPLOYMENTS="$(v "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=20&state=READY")"
DEPLOY_JSON="$(show 'list deployments' "$DEPLOYMENTS")"
DEPLOY_ID="$(printf '%s' "$DEPLOY_JSON" | python3 -c '
import json,sys
d = json.load(sys.stdin)
for dep in d.get("deployments", []):
    if dep.get("meta", {}).get("githubCommitRef") == "main":
        print(dep["uid"]); break
')"
if [ -z "${DEPLOY_ID}" ]; then
  echo "    no READY deployment of main found — push to main and re-run" >&2
  exit 1
fi
echo "    main deployment: ${DEPLOY_ID}"

echo "==> 2. Promote it to production"
show 'promote' "$(v -X POST \
  "https://api.vercel.com/v10/projects/${PROJECT_ID}/promote/${DEPLOY_ID}?teamId=${TEAM_ID}")" >/dev/null \
  || echo "    (if this 4xx'd, promote from the dashboard: Deployments -> ... -> Promote)"

echo "==> 3. Point the production branch at main"
show 'set production branch' "$(v -X PATCH \
  -H 'Content-Type: application/json' \
  -d "{\"gitRepository\":{\"type\":\"github\",\"repo\":\"${GITHUB_REPO}\",\"productionBranch\":\"main\"}}" \
  "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}")" >/dev/null \
  || echo "    (if this 4xx'd, set it in Settings -> Git -> Production Branch)"

echo "    production branch now:"
v "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  | sed '$d' | python3 -c 'import json,sys; print("      ", json.load(sys.stdin).get("link",{}).get("productionBranch"))' \
  2>/dev/null || echo "      (could not read back)"

echo "==> 4. Supabase auth config — before"
s "https://api.supabase.com/v1/projects/${SUPABASE_REF}/config/auth" | sed '$d' \
  | python3 -c '
import json,sys
c = json.load(sys.stdin)
for k in ("site_url", "uri_allow_list", "password_hibp_enabled"):
    print(f"      {k} = {c.get(k)!r}")
' 2>/dev/null || echo "      (could not read)"

echo "==> 5. Set Site URL, redirect allow list, leaked-password protection"
show 'patch auth config' "$(s -X PATCH \
  -H 'Content-Type: application/json' \
  -d "{
        \"site_url\": \"${SITE_URL}\",
        \"uri_allow_list\": \"${SITE_URL}/auth/callback,${SITE_URL}/**\",
        \"password_hibp_enabled\": true
      }" \
  "https://api.supabase.com/v1/projects/${SUPABASE_REF}/config/auth")" >/dev/null \
  || echo "    (if this 4xx'd, the field names are in the response above)"

echo "==> 6. Supabase auth config — after"
s "https://api.supabase.com/v1/projects/${SUPABASE_REF}/config/auth" | sed '$d' \
  | python3 -c '
import json,sys
c = json.load(sys.stdin)
for k in ("site_url", "uri_allow_list", "password_hibp_enabled"):
    print(f"      {k} = {c.get(k)!r}")
' 2>/dev/null || echo "      (could not read)"

echo
echo "Done. Revoke both tokens now — neither is needed again."
echo "Then sign in at ${SITE_URL}/login and you should be asked to set a new password."
