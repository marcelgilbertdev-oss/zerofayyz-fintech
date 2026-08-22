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

cd "$root"
npx --yes vercel@latest link --yes --project "$project" >/dev/null
mkdir -p "apps/$client/$out/.vercel"
cp .vercel/project.json "apps/$client/$out/.vercel/project.json"

cd "apps/$client/$out"
npx --yes vercel@latest --yes --prod
