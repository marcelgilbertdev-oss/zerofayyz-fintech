import {
  fetchLedger,
  LedgerFrame,
  LEDGER_TABLE,
  LEDGER_TBODY,
  LEDGER_THEAD,
  Pagination,
  resolvePage,
} from "@/components/ledger-shell";
import { ScrollableTable } from "@/components/app-shell";
import { formatMoney } from "@/i18n/locale";

const LIMIT = 20;

type EventsResponse = {
  data: Array<{
    id: string;
    paymentId: string;
    providerEventId: string | null;
    eventType: string;
    amountMinor: number;
    currency: string;
    occurredAt: string;
    customerEmail: string;
  }>;
  meta: { total: number; limit: number; offset: number };
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string | string[] }>;
}) {
  const { t, locale } = await resolvePage();
  const query = await searchParams;
  const offsetRaw = Array.isArray(query.offset) ? query.offset[0] : query.offset;
  const offset = Math.max(0, Number.parseInt(offsetRaw ?? "0", 10) || 0);

  const events = await fetchLedger<EventsResponse>(
    `/api/v1/events?limit=${LIMIT}&offset=${offset}`,
  );

  return (
    <LedgerFrame
      t={t}
      active="transactions"
      title={t.pages.events.title}
      subtitle={t.pages.events.subtitle}
    >
      {events === null ? (
        <p className="text-xs text-rose-200">{t.transactions.unavailableSource}</p>
      ) : events.data.length === 0 ? (
        <p className="text-xs text-white/50">{t.pages.events.empty}</p>
      ) : (
        <>
          <ScrollableTable label={t.nav.transactions}>
            <table className={LEDGER_TABLE}>
              <thead className={LEDGER_THEAD}>
                <tr>
                  <th className="px-4 py-3">{t.pages.events.occurred}</th>
                  <th className="px-4 py-3">{t.pages.events.eventId}</th>
                  <th className="px-4 py-3">{t.pages.events.eventType}</th>
                  <th className="px-4 py-3">{t.transactions.customer}</th>
                  <th className="px-4 py-3">{t.transactions.amount}</th>
                </tr>
              </thead>
              <tbody className={LEDGER_TBODY}>
                {events.data.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-white/60">
                      {new Date(event.occurredAt).toLocaleString(
                        locale === "ja" ? "ja-JP" : "en-US",
                        { dateStyle: "medium", timeStyle: "short" },
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-emerald-100/90">
                      {event.providerEventId ?? (
                        <span className="text-white/40">({t.pages.events.seeded})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-white/70">
                      {event.eventType}
                    </td>
                    <td className="px-4 py-3 text-white/60">{event.customerEmail}</td>
                    <td className="px-4 py-3 font-semibold text-white/85">
                      {formatMoney(event.amountMinor, event.currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>

          <Pagination
            t={t}
            basePath="/transactions"
            query={{}}
            limit={events.meta.limit}
            offset={events.meta.offset}
            total={events.meta.total}
          />
        </>
      )}
    </LedgerFrame>
  );
}
