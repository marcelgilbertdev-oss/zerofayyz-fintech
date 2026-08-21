#!/usr/bin/env bash
# Deploy a prebuilt SPA client to Vercel. See docs/runbooks/DEPLOYMENT.md §0 for
# why these do not build on Vercel.
set -euo pipefail

client="${1:?usage: ./deploy-clients.sh web-vue|web-svelte}"
project="zerofayyz-fintech-${client#web-}"
root="$(cd "$(dirname "$0")" && pwd)"

echo "Building $client locally (the shared contract lives above its root)…"
npm --prefix "$root/apps/$client" run build

cat > "$root/apps/$client/dist/vercel.json" <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "",
  "buildCommand": "",
  "outputDirectory": ".",
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://zerofayyz-fintech-api.onrender.com/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
JSON

cd "$root"
npx --yes vercel@latest link --yes --project "$project" >/dev/null
mkdir -p "apps/$client/dist/.vercel"
cp .vercel/project.json "apps/$client/dist/.vercel/project.json"

cd "apps/$client/dist"
npx --yes vercel@latest --yes --prod
