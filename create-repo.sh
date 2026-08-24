// create-repo.sh — creates the GitHub repo under birkleys-new-world and pushes.
// Usage: GITHUB_TOKEN=ghp_xxx bash create-repo.sh
set -e
ORG="birkleys-new-world"
REPO="tnw-photos"
cd "$(dirname "$0")"

if [ -z "$GITHUB_TOKEN" ]; then echo "set GITHUB_TOKEN"; exit 1; fi
AUTH="Authorization: Bearer $GITHUB_TOKEN"
H="Accept: application/vnd.github+json"

echo "== checking org $ORG =="
curl -s -o /dev/null -w "%{http_code}\n" -H "$AUTH" "https://api.github.com/orgs/$ORG" || true

echo "== creating repo =="
curl -s -X POST -H "$AUTH" -H "$H" \
  "https://api.github.com/orgs/$ORG/repos" \
  -d "{\"name\":\"$REPO\",\"description\":\"Lightweight photo ingest, rank & share for The New World\",\"private\":false,\"auto_init\":false}"

echo "== git push =="
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$GITHUB_TOKEN@github.com/$ORG/$REPO.git"
git push -u origin main
git remote set-url origin "https://github.com/$ORG/$REPO.git"
echo "DONE https://github.com/$ORG/$REPO"
