#!/usr/bin/env bash
# Deploy a prebuilt SPA client to Vercel. See docs/runbooks/DEPLOYMENT.md §0 for
# why these do not build on Vercel.
set -euo pipefail

client="${1:?usage: ./deploy-clients.sh web-vue|web-svelte}"
project="zerofayyz-fintech-${client#web-}"
root="$(cd "$(dirname "$0")" && pwd)"

# SvelteKit's static adapter writes to build/; the Vue client's plain Vite
# build writes to dist/. One script, two output conventions.
case "$client" in
  web-svelte) out="build" ;;
  *)          out="dist" ;;
esac

echo "Building $client locally (the shared contract lives above its root)…"
npm --prefix "$root/apps/$client" run build

cat > "$root/apps/$client/$out/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "",
  "buildCommand": "",
  "outputDirectory": ".",
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://zerofayyz-fintech-api.onrender.com/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }
      ]
    }
  ]
}
JSON

# Locally the CLI uses the session from `vercel login`. CI has no session, so
# it passes a token instead; without this the CLI would prompt and hang until
# the job times out. One code path, authenticated either way.
# macOS ships bash 3.2, where "${auth[@]}" on an empty array is an unbound
# variable under set -u. The ${auth[@]+...} guard expands to nothing instead.
auth=()
if [ -n "${VERCEL_TOKEN:-}" ]; then
  auth=(--token "$VERCEL_TOKEN")
fi
# These projects belong to a team. Without an explicit scope the CLI resolves
# against the token's own default, and a personal-scoped token would quietly
# CREATE a second project of the same name and deploy there — a green run
# pointing at a URL nobody is looking at. Name the team instead.
if [ -n "${VERCEL_SCOPE:-}" ]; then
  auth+=(--scope "$VERCEL_SCOPE")
fi

cd "$root"
npx --yes vercel@latest link --yes --project "$project" ${auth[@]+"${auth[@]}"} >/dev/null
mkdir -p "apps/$client/$out/.vercel"
cp .vercel/project.json "apps/$client/$out/.vercel/project.json"

cd "apps/$client/$out"
npx --yes vercel@latest --yes --prod ${auth[@]+"${auth[@]}"}
