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

type CustomersResponse = {
  data: Array<{
    id: string;
    displayName: string;
    email: string;
    paymentCount: number;
    succeededVolumeMinor: number;
    lastPaymentAt: string | null;
  }>;
  meta: { total: number; limit: number; offset: number };
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string | string[] }>;
}) {
  const { t, locale } = await resolvePage();
  const query = await searchParams;
  const offsetRaw = Array.isArray(query.offset) ? query.offset[0] : query.offset;
  const offset = Math.max(0, Number.parseInt(offsetRaw ?? "0", 10) || 0);

  const customers = await fetchLedger<CustomersResponse>(
    `/api/v1/customers?limit=${LIMIT}&offset=${offset}`,
  );

  return (
    <LedgerFrame
      t={t}
      active="customers"
      title={t.pages.customers.title}
      subtitle={t.pages.customers.subtitle}
    >
      {customers === null ? (
        <p className="text-xs text-rose-200">{t.transactions.unavailableSource}</p>
      ) : customers.data.length === 0 ? (
        <p className="text-xs text-white/50">{t.pages.customers.empty}</p>
      ) : (
        <>
          <ScrollableTable label={t.nav.customers}>
            <table className={LEDGER_TABLE}>
              <thead className={LEDGER_THEAD}>
                <tr>
                  <th className="px-4 py-3">{t.pages.customers.customer}</th>
                  <th className="px-4 py-3">{t.pages.customers.payments}</th>
                  <th className="px-4 py-3">{t.pages.customers.volume}</th>
                  <th className="px-4 py-3">{t.pages.customers.lastActivity}</th>
                </tr>
              </thead>
              <tbody className={LEDGER_TBODY}>
                {customers.data.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-white/90">{customer.displayName}</span>
                      <span className="ml-2 text-white/50">{customer.email}</span>
                    </td>
                    <td className="px-4 py-3 text-white/70">{customer.paymentCount}</td>
                    <td className="px-4 py-3 font-semibold text-white/85">
                      {formatMoney(customer.succeededVolumeMinor, "USD", locale)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-white/60">
                      {customer.lastPaymentAt
                        ? new Date(customer.lastPaymentAt).toLocaleString(
                            locale === "ja" ? "ja-JP" : "en-US",
                            { dateStyle: "medium", timeStyle: "short" },
                          )
                        : t.pages.customers.never}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>

          <Pagination
            t={t}
            basePath="/customers"
            query={{}}
            limit={customers.meta.limit}
            offset={customers.meta.offset}
            total={customers.meta.total}
          />
        </>
      )}
    </LedgerFrame>
  );
}
