/**
 * "Down" and "we never got an answer" are different facts, and a dashboard that
 * reports the second as the first is lying to its reader.
 *
 * The API runs as a single hosted service. A service that has been idle can take
 * tens of seconds to answer its first request while it starts, which is longer
 * than any sensible page-render budget. The old code caught that timeout and
 * rendered "PostgreSQL — Unavailable", which is a claim about a database we had
 * not managed to ask anything about. The database was fine every time.
 *
 * So the classification here turns on one question: did the server answer at all?
 *
 *   - It answered, and the answer was good        -> reachable
 *   - It answered with an error status            -> down    (a real, reportable fault)
 *   - It never answered: timeout, abort, DNS,     -> waking  (no evidence either way;
 *     refused connection                                      starting is the likely cause)
 *
 * Only the middle case is evidence of a fault. The third case is the absence of
 * evidence, and the UI is expected to say so rather than invent a diagnosis.
 */
export type Reachability = "reachable" | "waking" | "down";

/**
 * Deliberately shorter than a cold start.
 *
 * It is tempting to raise this until it covers the worst start-up we have
 * measured, but the fetch happens while rendering the page, so a long timeout
 * holds the whole response hostage — and the platform has its own function
 * ceiling that a long enough wait would hit anyway, turning a slow page into an
 * error page. The page renders fast and honestly instead, and WakeWatcher
 * refreshes it when the API answers.
 */
export const DEFAULT_API_TIMEOUT_MS = 8_000;

export function apiTimeoutMs(): number {
  const configured = Number.parseInt(process.env.API_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_API_TIMEOUT_MS;
}

/**
 * A fetch that never throws, and that reports why it failed.
 *
 * `response` is present only when the server actually answered, so callers
 * cannot accidentally treat silence as a response.
 */
export type ProbeResult =
  | { reachability: "reachable"; response: Response }
  | { reachability: "down"; response: Response | null }
  | { reachability: "waking"; response: null };

export async function probe(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<ProbeResult> {
  const { timeoutMs, ...rest } = init ?? {};

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs ?? apiTimeoutMs()),
      ...rest,
    });

    // The server spoke. Whatever it said is evidence, including a 503.
    return response.ok
      ? { reachability: "reachable", response }
      : { reachability: "down", response };
  } catch {
    // Nothing came back: a timeout, an aborted connection, a refused socket, a
    // DNS failure. None of these tell us anything about the service's internals,
    // and on this deployment the overwhelmingly common cause is a cold start.
    return { reachability: "waking", response: null };
  }
}

/**
 * Combines the reachability of several probes into the state the page should
 * report. `down` wins over `waking`: if any part of the system answered with a
 * fault, that is a hard fact and outranks the absence of one.
 */
export function worstOf(states: readonly Reachability[]): Reachability {
  if (states.includes("down")) return "down";
  if (states.includes("waking")) return "waking";
  return "reachable";
}
