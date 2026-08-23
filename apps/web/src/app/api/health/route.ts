import { probe } from "@/lib/api-reachability";

const API_BASE_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

/**
 * A reachability probe the browser can poll while the API starts.
 *
 * The page itself is server-rendered, so once it has rendered in a "starting"
 * state it has no way to notice the API coming up. WakeWatcher polls this and
 * asks Next.js for a fresh render as soon as the answer is yes.
 *
 * It deliberately returns only a boolean. The dashboard already has a detailed
 * health panel; duplicating it here would mean two code paths that can disagree
 * about the same system.
 */
export async function GET() {
  const result = await probe(`${API_BASE_URL}/api/v1/health`);

  return Response.json(
    { reachable: result.reachability === "reachable" },
    {
      status: 200,
      // A cached answer would make the watcher poll its own stale reply forever.
      headers: { "cache-control": "no-store" },
    },
  );
}
