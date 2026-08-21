import {
  fetchLedger,
  LedgerFrame,
  LEDGER_TABLE,
  LEDGER_TABLE_WRAP,
  LEDGER_TBODY,
  LEDGER_THEAD,
  Pagination,
  resolvePage,
} from "@/components/ledger-shell";
import { formatMoney } from "@/i18n/locale";

const STATUSES = ["succeeded", "processing", "failed", "canceled", "refunded"] as const;
const LIMIT = 20;

type PaymentsResponse = {
  data: Array<{
    id: string;
    customer: { displayName: string; email: string };
    amountMinor: number;
    currency: string;
    status: string;
    description: string | null;
    methodLabel: string;
    createdAt: string;
  }>;
  meta: { total: number; limit: number; offset: number };
};

const STATUS_STYLES: Record<string, string> = {
  succeeded: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  processing: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  refunded: "border-amber-300/20 bg-amber-300/10 text-amber-200",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; offset?: string | string[] }>;
}) {
  const { t, locale } = await resolvePage();
  const query = await searchParams;
  const requestedStatus = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = STATUSES.includes(requestedStatus as (typeof STATUSES)[number])
    ? (requestedStatus as (typeof STATUSES)[number])
    : null;
  const offsetRaw = Array.isArray(query.offset) ? query.offset[0] : query.offset;
  const offset = Math.max(0, Number.parseInt(offsetRaw ?? "0", 10) || 0);

  const parameters = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });

  if (status) {
    parameters.set("status", status);
  }

  const payments = await fetchLedger<PaymentsResponse>(`/api/v1/payments?${parameters}`);

  const filterHref = (value: string | null) =>
    value ? `/payments?status=${value}` : "/payments";

  return (
    <LedgerFrame
      t={t}
      active="payments"
      title={t.pages.payments.title}
      subtitle={t.pages.payments.subtitle}
    >
      <nav
        aria-label={t.pages.payments.filterLabel}
        className="mb-6 flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-1.5"
      >
        {[null, ...STATUSES].map((value) => (
          <a
            key={value ?? "all"}
            href={filterHref(value)}
            aria-current={status === value ? "page" : undefined}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
              status === value
                ? "bg-white/[0.09] text-white shadow-[inset_0_-2px_0_#6ee7b7]"
                : "text-white/60 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {value ? t.status[value] : t.pages.payments.all}
          </a>
        ))}
      </nav>

      {payments === null ? (
        <p className="text-xs text-rose-200">{t.transactions.unavailableSource}</p>
      ) : payments.data.length === 0 ? (
        <p className="text-xs text-white/50">{t.pages.payments.empty}</p>
      ) : (
        <>
          <div className={LEDGER_TABLE_WRAP}>
            <table className={LEDGER_TABLE}>
              <thead className={LEDGER_THEAD}>
                <tr>
                  <th className="px-4 py-3">{t.transactions.customer}</th>
                  <th className="px-4 py-3">{t.transactions.amount}</th>
                  <th className="px-4 py-3">{t.transactions.method}</th>
                  <th className="px-4 py-3">{t.pages.payments.description}</th>
                  <th className="px-4 py-3">{t.transactions.status}</th>
                  <th className="px-4 py-3">{t.transactions.time}</th>
                </tr>
              </thead>
              <tbody className={LEDGER_TBODY}>
                {payments.data.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-white/90">
                        {payment.customer.displayName}
                      </span>
                      <span className="ml-2 text-white/50">{payment.customer.email}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-white/85">
                      {formatMoney(payment.amountMinor, payment.currency, locale)}
                    </td>
                    <td className="px-4 py-3 text-white/60">{payment.methodLabel}</td>
                    <td className="max-w-56 truncate px-4 py-3 text-white/50">
                      {payment.description ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[payment.status] ?? "border-white/15 bg-white/5 text-white/70"}`}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {t.status[payment.status as keyof typeof t.status] ?? payment.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-white/60">
                      {new Date(payment.createdAt).toLocaleString(
                        locale === "ja" ? "ja-JP" : "en-US",
                        { dateStyle: "medium", timeStyle: "short" },
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            t={t}
            basePath="/payments"
            query={status ? { status } : {}}
            limit={payments.meta.limit}
            offset={payments.meta.offset}
            total={payments.meta.total}
          />
        </>
      )}
    </LedgerFrame>
  );
}
