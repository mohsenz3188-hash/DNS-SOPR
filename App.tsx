import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type Panel = ApiResponse<typeof api, "getPanel">;
type Zone = Panel["zones"][number];
type Rec = Panel["records"][number];

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR", "SOA"] as const;
const TTL_OPTIONS = [60, 300, 600, 1800, 3600, 14400, 86400];
const TYPE_COLORS: Record<string, string> = {
  A: "#2563eb", AAAA: "#7c3aed", CNAME: "#0891b2", MX: "#d97706", TXT: "#059669",
  NS: "#db2777", SRV: "#9333ea", CAA: "#ea580c", PTR: "#64748b", SOA: "#475569",
};

type View = "dashboard" | "zones" | "records" | "checker" | "deploy";

const NAV: Array<{ key: View; label: string; icon: string }> = [
  { key: "dashboard", label: "داشبورد", icon: "▦" },
  { key: "zones", label: "زون‌ها", icon: "◎" },
  { key: "records", label: "رکوردها", icon: "☰" },
  { key: "checker", label: "بررسی DNS", icon: "⌕" },
  { key: "deploy", label: "نصب روی سرور", icon: "⇩" },
];

function fqdn(rec: { name: string }, zoneName: string): string {
  if (rec.name === "@" || rec.name === "") return zoneName;
  if (rec.name.endsWith(zoneName)) return rec.name;
  return `${rec.name}.${zoneName}`;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("dashboard");
  const [zoneFilter, setZoneFilter] = useState<number | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [zoneModal, setZoneModal] = useState<{ mode: "create" } | { mode: "edit"; zone: Zone } | null>(null);
  const [recordModal, setRecordModal] = useState<{ mode: "create"; zoneId?: number } | { mode: "edit"; record: Rec } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const panel = useQuery({ queryKey: ["panel"], queryFn: () => api.getPanel({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["panel"] });

  const deleteZone = useMutation({
    mutationFn: (id: number) => api.deleteZone({ id }),
    onSuccess: () => { invalidate(); setConfirmDelete(null); },
  });
  const deleteRecord = useMutation({
    mutationFn: (id: number) => api.deleteRecord({ id }),
    onSuccess: () => { invalidate(); setConfirmDelete(null); },
  });
  const toggleRecord = useMutation({
    mutationFn: (args: { id: number; enabled: boolean }) => api.toggleRecord(args),
    onSuccess: invalidate,
  });

  const data = panel.data;
  const filteredRecords = useMemo(() => {
    if (!data) return [];
    return data.records.filter((r) => {
      if (zoneFilter !== "all" && r.zoneId !== zoneFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${fqdn(r, r.zoneName)} ${r.content} ${r.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, zoneFilter, typeFilter, search]);

  const goRecords = (zoneId: number | "all") => {
    setZoneFilter(zoneId);
    setView("records");
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--sidebar)" />
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col md:flex-row">
        {/* Sidebar — X-UI style */}
        <aside className="shrink-0 bg-[var(--sidebar)] text-[var(--sidebar-text)] md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col">
          <div className="flex items-center gap-3 px-4 pb-2 pt-safe md:pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00b578] text-lg font-extrabold text-white">D</div>
            <div>
              <p className="text-base font-extrabold leading-5 text-white">DNS Panel</p>
              <p className="text-xs opacity-70">پنل مدیریت DNS</p>
            </div>
          </div>
          <nav aria-label="ناوبری اصلی" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:py-4">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                aria-current={view === n.key ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  view === n.key ? "bg-[#00b578] text-white" : "hover:bg-white/10"
                }`}
              >
                <span aria-hidden="true">{n.icon}</span>
                {n.label}
                {n.key === "zones" && data ? <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{data.stats.zoneCount}</span> : null}
                {n.key === "records" && data ? <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{data.stats.recordCount}</span> : null}
              </button>
            ))}
          </nav>
          <div className="mt-auto hidden px-4 pb-5 text-xs leading-5 opacity-60 md:block">
            رکوردها در دیتابیس همین پنل ذخیره می‌شوند. برای بررسی انتشار جهانی از بخش «بررسی DNS» استفاده کنید.
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 px-4 py-5 md:px-7 md:py-7">
          {panel.isPending ? (
            <p className="py-16 text-center text-sm text-[var(--dim)]">در حال بارگذاری پنل…</p>
          ) : panel.error ? (
            <div className="py-16 text-center">
              <p className="text-sm text-[var(--danger)]">خطا در بارگذاری اطلاعات پنل</p>
              <button onClick={() => panel.refetch()} className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">تلاش دوباره</button>
            </div>
          ) : data ? (
            <>
              {view === "dashboard" && (
                <Dashboard data={data} onGoRecords={goRecords} onAddZone={() => setZoneModal({ mode: "create" })} />
              )}
              {view === "zones" && (
                <ZonesView
                  data={data}
                  onAdd={() => setZoneModal({ mode: "create" })}
                  onEdit={(z) => setZoneModal({ mode: "edit", zone: z })}
                  onDelete={(id) => deleteZone.mutate(id)}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                  onGoRecords={goRecords}
                  onAddRecord={(zoneId) => setRecordModal({ mode: "create", zoneId })}
                />
              )}
              {view === "records" && (
                <RecordsView
                  data={data}
                  records={filteredRecords}
                  zoneFilter={zoneFilter}
                  setZoneFilter={setZoneFilter}
                  typeFilter={typeFilter}
                  setTypeFilter={setTypeFilter}
                  search={search}
                  setSearch={setSearch}
                  onAdd={() => setRecordModal({ mode: "create", zoneId: zoneFilter === "all" ? undefined : zoneFilter })}
                  onEdit={(r) => setRecordModal({ mode: "edit", record: r })}
                  onDelete={(id) => deleteRecord.mutate(id)}
                  onToggle={(r) => toggleRecord.mutate({ id: r.id, enabled: !r.enabled })}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                />
              )}
              {view === "checker" && <CheckerView />}
              {view === "deploy" && <DeployView />}
            </>
          ) : null}
        </main>
      </div>

      {zoneModal && data && (
        <ZoneModal
          key={zoneModal.mode === "edit" ? zoneModal.zone.id : "new"}
          state={zoneModal}
          onClose={() => setZoneModal(null)}
          onSaved={() => { setZoneModal(null); invalidate(); }}
        />
      )}
      {recordModal && data && (
        <RecordModal
          key={recordModal.mode === "edit" ? recordModal.record.id : "new"}
          state={recordModal}
          zones={data.zones}
          onClose={() => setRecordModal(null)}
          onSaved={() => { setRecordModal(null); invalidate(); }}
          onNeedZone={() => { setRecordModal(null); setZoneModal({ mode: "create" }); }}
        />
      )}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function Dashboard({ data, onGoRecords, onAddZone }: { data: Panel; onGoRecords: (z: number | "all") => void; onAddZone: () => void }) {
  const s = data.stats;
  const maxType = Math.max(1, ...s.byType.map((t) => t.count));
  const cards = [
    { label: "زون (دامنه)", value: s.zoneCount, color: "#2563eb" },
    { label: "کل رکوردها", value: s.recordCount, color: "#00b578" },
    { label: "رکورد فعال", value: s.activeCount, color: "#059669" },
    { label: "رکورد غیرفعال", value: s.disabledCount, color: "#d97706" },
  ];
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">داشبورد</h1>
        <button onClick={onAddZone} className="rounded-lg bg-[#00b578] px-4 py-2 text-sm font-bold text-white">+ افزودن دامنه</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-2 h-1.5 w-10 rounded-full" style={{ background: c.color }} />
            <p className="text-3xl font-extrabold">{c.value.toLocaleString("fa-IR")}</p>
            <p className="mt-1 text-sm text-[var(--dim)]">{c.label}</p>
          </div>
        ))}
      </div>

      {data.zones.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-lg font-bold">هنوز دامنه‌ای اضافه نشده است</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--dim)]">
            مثل X-UI که اول اینباند می‌سازید، اینجا اول یک زون (دامنه) بسازید و بعد رکوردهای DNS آن را مدیریت کنید.
          </p>
          <button onClick={onAddZone} className="mt-4 rounded-lg bg-[#00b578] px-5 py-2.5 text-sm font-bold text-white">ساخت اولین دامنه</button>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-5">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-3">
            <h2 className="mb-3 font-bold">زون‌ها</h2>
            <ul className="divide-y divide-[var(--border)]">
              {data.zones.map((z) => (
                <li key={z.id}>
                  <button onClick={() => onGoRecords(z.id)} className="flex w-full items-center justify-between gap-3 py-3 text-right">
                    <span className="mono min-w-0 truncate text-sm font-semibold">{z.name}</span>
                    <span className="shrink-0 text-xs text-[var(--dim)]">
                      {z.activeCount.toLocaleString("fa-IR")} فعال از {z.recordCount.toLocaleString("fa-IR")} رکورد ←
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-2">
            <h2 className="mb-3 font-bold">توزیع نوع رکوردها</h2>
            {s.byType.length === 0 ? (
              <p className="text-sm text-[var(--dim)]">هنوز رکوردی ثبت نشده است.</p>
            ) : (
              <ul className="space-y-3">
                {s.byType.map((t) => (
                  <li key={t.type}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="mono font-bold">{t.type}</span>
                      <span className="text-[var(--dim)]">{t.count.toLocaleString("fa-IR")}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface2)]">
                      <div className="h-full rounded-full" style={{ width: `${(t.count / maxType) * 100}%`, background: TYPE_COLORS[t.type] ?? "#64748b" }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {data.records.length > 0 && (
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">آخرین رکوردهای ویرایش‌شده</h2>
            <button onClick={() => onGoRecords("all")} className="text-sm font-medium text-[var(--accent)]">مشاهده همه</button>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {data.records.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <TypeBadge type={r.type} />
                <span className="mono min-w-0 flex-1 truncate">{fqdn(r, r.zoneName)}</span>
                <span className="mono hidden max-w-[40%] truncate text-[var(--dim)] sm:block">{r.content}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.enabled ? "bg-emerald-500" : "bg-slate-400"}`} aria-label={r.enabled ? "فعال" : "غیرفعال"} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---------------- Zones ---------------- */

function ZonesView(props: {
  data: Panel;
  onAdd: () => void;
  onEdit: (z: Zone) => void;
  onDelete: (id: number) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  onGoRecords: (z: number) => void;
  onAddRecord: (zoneId: number) => void;
}) {
  const { data } = props;
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">زون‌ها (دامنه‌ها)</h1>
        <button onClick={props.onAdd} className="rounded-lg bg-[#00b578] px-4 py-2 text-sm font-bold text-white">+ دامنه جدید</button>
      </div>
      {data.zones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="font-bold">هیچ زونی وجود ندارد</p>
          <p className="mt-2 text-sm text-[var(--dim)]">یک دامنه مثل example.com اضافه کنید تا رکوردهایش را مدیریت کنید.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.zones.map((z) => {
            const key = `zone-${z.id}`;
            return (
              <article key={z.id} className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="mono truncate text-base font-bold">{z.name}</p>
                {z.description ? <p className="mt-1 line-clamp-2 text-sm text-[var(--dim)]">{z.description}</p> : null}
                <p className="mt-3 text-xs text-[var(--dim)]">
                  {z.recordCount.toLocaleString("fa-IR")} رکورد · {z.activeCount.toLocaleString("fa-IR")} فعال
                </p>
                <p className="mt-1 text-xs text-[var(--dim)]">ایجاد: {fmtDate(z.created_at)}</p>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                  <button onClick={() => props.onGoRecords(z.id)} className="rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-bold text-[var(--accent)]">رکوردها</button>
                  <button onClick={() => props.onAddRecord(z.id)} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">+ رکورد</button>
                  <button onClick={() => exportZoneFile(z, props.data.records.filter((r) => r.zoneId === z.id))} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">خروجی Zone File</button>
                  <button onClick={() => props.onEdit(z)} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">ویرایش</button>
                  {props.confirmDelete === key ? (
                    <>
                      <button onClick={() => props.onDelete(z.id)} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-bold text-white">حذف قطعی؟</button>
                      <button onClick={() => props.setConfirmDelete(null)} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">انصراف</button>
                    </>
                  ) : (
                    <button onClick={() => props.setConfirmDelete(key)} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]">حذف</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function exportZoneFile(zone: Zone, records: Rec[]) {
  const lines = [
    `; Zone file for ${zone.name} — exported from DNS Panel`,
    `$ORIGIN ${zone.name}.`,
    `$TTL 3600`,
    ...records.filter((r) => r.enabled).map((r) => {
      const name = r.name === "@" ? "@" : r.name;
      const prio = r.priority != null ? `${r.priority} ` : "";
      const content = r.type === "TXT" && !r.content.startsWith('"') ? `"${r.content}"` : r.content;
      return `${name}\t${r.ttl}\tIN\t${r.type}\t${prio}${content}`;
    }),
    "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${zone.name}.zone`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Records ---------------- */

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="mono inline-block min-w-14 rounded-md px-2 py-0.5 text-center text-xs font-bold text-white" style={{ background: TYPE_COLORS[type] ?? "#64748b" }}>
      {type}
    </span>
  );
}

function RecordsView(props: {
  data: Panel;
  records: Rec[];
  zoneFilter: number | "all";
  setZoneFilter: (v: number | "all") => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  onAdd: () => void;
  onEdit: (r: Rec) => void;
  onDelete: (id: number) => void;
  onToggle: (r: Rec) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
}) {
  const { data, records } = props;
  const inputCls = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">رکوردهای DNS</h1>
        <button onClick={props.onAdd} disabled={data.zones.length === 0} className="rounded-lg bg-[#00b578] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">+ رکورد جدید</button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="zone-filter">فیلتر زون</label>
        <select id="zone-filter" className={inputCls} value={props.zoneFilter === "all" ? "all" : String(props.zoneFilter)} onChange={(e) => props.setZoneFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
          <option value="all">همه دامنه‌ها</option>
          {data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="type-filter">فیلتر نوع رکورد</label>
        <select id="type-filter" className={inputCls} value={props.typeFilter} onChange={(e) => props.setTypeFilter(e.target.value)}>
          <option value="all">همه نوع‌ها</option>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="sr-only" htmlFor="record-search">جستجو در رکوردها</label>
        <input id="record-search" className={`${inputCls} min-w-44 flex-1 sm:flex-none`} placeholder="جستجو: نام، مقدار، IP…" value={props.search} onChange={(e) => props.setSearch(e.target.value)} />
      </div>

      {data.zones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="font-bold">اول یک دامنه بسازید</p>
          <p className="mt-2 text-sm text-[var(--dim)]">رکوردها داخل زون (دامنه) تعریف می‌شوند.</p>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="font-bold">رکوردی پیدا نشد</p>
          <p className="mt-2 text-sm text-[var(--dim)]">فیلترها را تغییر دهید یا یک رکورد جدید بسازید.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface2)] text-right text-xs text-[var(--dim)]">
                  <th className="px-4 py-3 font-medium">وضعیت</th>
                  <th className="px-4 py-3 font-medium">نام</th>
                  <th className="px-4 py-3 font-medium">نوع</th>
                  <th className="px-4 py-3 font-medium">مقدار</th>
                  <th className="px-4 py-3 font-medium">TTL</th>
                  <th className="px-4 py-3 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {records.map((r) => (
                  <tr key={r.id} className={r.enabled ? "" : "opacity-55"}>
                    <td className="px-4 py-3">
                      <button onClick={() => props.onToggle(r)} aria-label={r.enabled ? `غیرفعال کردن رکورد ${fqdn(r, r.zoneName)}` : `فعال کردن رکورد ${fqdn(r, r.zoneName)}`} className={`relative h-6 w-11 rounded-full transition-colors ${r.enabled ? "bg-emerald-500" : "bg-slate-400"}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${r.enabled ? "right-0.5" : "right-[22px]"}`} />
                      </button>
                    </td>
                    <td className="mono px-4 py-3 font-semibold">{fqdn(r, r.zoneName)}</td>
                    <td className="px-4 py-3"><TypeBadge type={r.type} /></td>
                    <td className="mono max-w-xs truncate px-4 py-3 text-[var(--dim)]">{r.priority != null ? `${r.priority} ` : ""}{r.content}</td>
                    <td className="mono px-4 py-3">{r.ttl}</td>
                    <td className="px-4 py-3">
                      <RowActions r={r} {...props} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {records.map((r) => (
              <article key={r.id} className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="mono min-w-0 break-all text-sm font-bold">{fqdn(r, r.zoneName)}</p>
                  <TypeBadge type={r.type} />
                </div>
                <p className="mono mt-2 break-all text-sm text-[var(--dim)]">{r.priority != null ? `${r.priority} ` : ""}{r.content}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                  <button onClick={() => props.onToggle(r)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${r.enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-slate-400/20 text-[var(--dim)]"}`}>
                    {r.enabled ? "● فعال" : "○ غیرفعال"}
                  </button>
                  <span className="mono text-xs text-[var(--dim)]">TTL {r.ttl}</span>
                  <span className="mr-auto flex gap-2"><RowActions r={r} {...props} /></span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function RowActions(props: {
  r: Rec;
  onEdit: (r: Rec) => void;
  onDelete: (id: number) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
}) {
  const { r } = props;
  const key = `rec-${r.id}`;
  if (props.confirmDelete === key) {
    return (
      <span className="flex gap-1.5">
        <button onClick={() => props.onDelete(r.id)} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-bold text-white">حذف قطعی؟</button>
        <button onClick={() => props.setConfirmDelete(null)} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">انصراف</button>
      </span>
    );
  }
  return (
    <span className="flex gap-1.5">
      <button onClick={() => props.onEdit(r)} aria-label={`ویرایش رکورد ${r.name}`} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold">ویرایش</button>
      <button onClick={() => props.setConfirmDelete(key)} aria-label={`حذف رکورد ${r.name}`} className="rounded-lg bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]">حذف</button>
    </span>
  );
}

/* ---------------- DNS Checker ---------------- */

const DNS_STATUS: Record<number, string> = {
  0: "موفق (NOERROR) — رکورد پیدا شد",
  2: "خطای سرور (SERVFAIL)",
  3: "دامنه وجود ندارد (NXDOMAIN)",
  5: "درخواست رد شد (REFUSED)",
};

function CheckerView() {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("A");
  const check = useMutation({
    mutationFn: async (args: { name: string; type: string }) =>
      api.checkDns({ name: args.name, type: args.type as (typeof RECORD_TYPES)[number] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) check.mutate({ name: name.trim(), type });
  };
  const inputCls = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
  return (
    <section>
      <h1 className="mb-2 text-2xl font-extrabold">بررسی DNS زنده</h1>
      <p className="mb-5 max-w-2xl text-sm leading-6 text-[var(--dim)]">
        هر نام دامنه‌ای را وارد کنید تا رکورد فعلی آن از DNS عمومی گوگل (DNS-over-HTTPS) خوانده شود — برای بررسی انتشار تغییرات DNS در اینترنت.
      </p>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="check-name">نام دامنه برای بررسی</label>
        <input id="check-name" dir="ltr" className={`${inputCls} mono min-w-56 flex-1 sm:flex-none sm:w-80`} placeholder="example.com" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="check-type">نوع رکورد</label>
        <select id="check-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" disabled={check.isPending || !name.trim()} className="rounded-lg bg-[#00b578] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
          {check.isPending ? "در حال بررسی…" : "بررسی"}
        </button>
      </form>

      {check.error ? <p className="mt-4 text-sm text-[var(--danger)]">خطا: {String((check.error as Error).message ?? check.error)}</p> : null}
      {check.data ? (
        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm">
            وضعیت: <strong>{DNS_STATUS[check.data.status] ?? `کد ${check.data.status}`}</strong>
            <span className="mr-3 text-xs text-[var(--dim)]">{fmtDate(check.data.checkedAt)}</span>
          </p>
          {check.data.answers.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--dim)]">پاسخی برای این نوع رکورد برنگشت.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {check.data.answers.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <TypeBadge type={a.type} />
                  <span className="mono font-semibold">{a.name}</span>
                  <span className="mono min-w-0 flex-1 break-all text-[var(--dim)]">{a.data}</span>
                  <span className="mono text-xs text-[var(--dim)]">TTL {a.ttl}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- Deploy / GitHub ---------------- */

const INSTALL_CMD = "curl -sSL https://raw.githubusercontent.com/mohsenz3188-hash/DNS-SOPR/main/install.sh | bash";
const REPO_URL = "https://github.com/mohsenz3188-hash/DNS-SOPR.git";
const SYSTEMD_UNIT = `[Unit]
Description=DNS Panel
After=network.target

[Service]
Type=simple
User=dns-panel
WorkingDirectory=/opt/dns-panel
ExecStart=/usr/bin/node /opt/dns-panel/standalone/server.js
Restart=always
RestartSec=3
Environment=PORT=2053
Environment=DATA_DIR=/opt/dns-panel/data

[Install]
WantedBy=multi-user.target`;

function CopyBlock({ label, text, mono = true }: { label: string; text: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[#0b1220]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs text-slate-300">{label}</span>
        <button onClick={copy} className="rounded-md bg-white/10 px-3 py-1 text-xs font-bold text-white">{copied ? "کپی شد ✓" : "کپی"}</button>
      </div>
      <pre dir="ltr" className={`${mono ? "mono" : ""} overflow-x-auto p-3 text-left text-xs leading-5 text-emerald-300`}>{text}</pre>
    </div>
  );
}

function DeployView() {
  const steps = [
    { t: "۱) فایل‌ها را در مخزن گیت‌هاب پوش کنید", d: "پوشه پروژه (همین فایل‌ها: install.sh، README.md، dns-panel.service و پوشه standalone) را در مخزن عمومی گیت‌هاب mohsenz3188-hash/DNS-SOPR روی شاخه main پوش کنید؛ دستور نصب زیر مستقیم از همان مخزن خوانده می‌شود." },
    { t: "۲) روی سرور لینوکس اجرا کنید", d: "دستور تک‌خطی زیر را در ترمینال سرور (Ubuntu/Debian) با دسترسی root یا sudo اجرا کنید. اسکریپت Node.js را نصب می‌کند، فایل‌ها را در /opt/dns-panel می‌گذارد، کاربر سیستمی می‌سازد و سرویس systemd را فعال می‌کند." },
    { t: "۳) وارد پنل شوید", d: "بعد از نصب، پنل روی پورت 2053 سرور در دسترس است: http://YOUR-SERVER-IP:2053 — مدیریت سرویس با systemctl status dns-panel و مشاهده لاگ با journalctl -u dns-panel -f انجام می‌شود." },
  ];
  return (
    <section>
      <h1 className="mb-2 text-2xl font-extrabold">نصب روی سرور — مثل X-UI</h1>
      <p className="mb-5 max-w-2xl text-sm leading-6 text-[var(--dim)]">
        پروژه آماده آپلود در گیت‌هاب است و با یک دستور تک‌خطی روی سرور لینوکس نصب می‌شود؛ دقیقاً مثل پنل‌های X-UI. نسخه مستقل سرور (پوشه standalone) فقط با Node.js اجرا می‌شود و وابستگی خارجی ندارد.
      </p>

      <div className="space-y-5">
        <CopyBlock label="دستور نصب تک‌خطی (روی سرور اجرا کنید)" text={INSTALL_CMD} />

        <CopyBlock label="آدرس مخزن گیت‌هاب (REPO_URL)" text={REPO_URL} />

        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.t} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="font-bold">{s.t}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--dim)]">{s.d}</p>
            </li>
          ))}
        </ol>

        <div>
          <h2 className="mb-2 font-bold">سرویس systemd ‏(dns-panel.service)</h2>
          <CopyBlock label="systemd unit" text={SYSTEMD_UNIT} />
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-2 font-bold">ساختار مخزن گیت‌هاب</h2>
          <pre dir="ltr" className="mono overflow-x-auto text-left text-xs leading-6 text-[var(--dim)]">{`DNS-SOPR/
├── install.sh            # اسکریپت نصب تک‌خطی
├── README.md             # راهنمای نصب و استفاده
├── dns-panel.service     # یونیت systemd
├── standalone/
│   ├── server.js         # سرور مستقل پنل (فقط Node.js)
│   └── package.json
└── (نسخه وب Muse در client/ و server/)`}</pre>
          <p className="mt-3 text-sm leading-6 text-[var(--dim)]">
            فایل‌های install.sh و README.md و dns-panel.service و پوشه standalone داخل همین پروژه قرار گرفته‌اند تا مستقیم آن را در گیت‌هاب آپلود کنید. اسکریپت نصب idempotent است؛ اجرای دوباره آن فقط فایل‌ها را به‌روز می‌کند و داده‌های ذخیره‌شده در /opt/dns-panel/data پاک نمی‌شوند.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Modals ---------------- */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label="بستن" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface2)] text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const fieldCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

function ZoneModal({ state, onClose, onSaved }: {
  state: { mode: "create" } | { mode: "edit"; zone: Zone };
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.zone : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: async () => {
      if (editing) return api.updateZone({ id: editing.id, name, description });
      return api.createZone({ name, description });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "خطایی رخ داد"),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(""); mut.mutate(); };
  return (
    <ModalShell title={editing ? "ویرایش دامنه" : "افزودن دامنه (زون)"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="zone-name">نام دامنه</label>
          <input id="zone-name" dir="ltr" className={`${fieldCls} mono`} placeholder="example.com" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls} htmlFor="zone-desc">توضیح (اختیاری)</label>
          <input id="zone-desc" className={fieldCls} placeholder="مثلاً دامنه اصلی سایت" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={mut.isPending || !name.trim()} className="flex-1 rounded-lg bg-[#00b578] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            {mut.isPending ? "در حال ذخیره…" : editing ? "ذخیره تغییرات" : "افزودن دامنه"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 text-sm font-bold">انصراف</button>
        </div>
      </form>
    </ModalShell>
  );
}

function RecordModal({ state, zones, onClose, onSaved, onNeedZone }: {
  state: { mode: "create"; zoneId?: number } | { mode: "edit"; record: Rec };
  zones: Zone[];
  onClose: () => void;
  onSaved: () => void;
  onNeedZone: () => void;
}) {
  const editing = state.mode === "edit" ? state.record : null;
  const [zoneId, setZoneId] = useState<number>(editing?.zoneId ?? (state.mode === "create" ? state.zoneId : undefined) ?? zones[0]?.id ?? 0);
  const [name, setName] = useState(editing?.name ?? "@");
  const [type, setType] = useState<string>(editing?.type ?? "A");
  const [content, setContent] = useState(editing?.content ?? "");
  const [ttl, setTtl] = useState<number>(editing?.ttl ?? 3600);
  const [priority, setPriority] = useState<string>(editing?.priority != null ? String(editing.priority) : "10");
  const [error, setError] = useState("");
  const needsPriority = type === "MX" || type === "SRV";

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim() || "@",
        type: type as (typeof RECORD_TYPES)[number],
        content: content.trim(),
        ttl,
        priority: needsPriority ? Number(priority || 10) : null,
      };
      if (editing) return api.updateRecord({ id: editing.id, ...payload });
      return api.createRecord({ zoneId, ...payload });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "خطایی رخ داد"),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(""); mut.mutate(); };

  if (zones.length === 0) {
    return (
      <ModalShell title="رکورد جدید" onClose={onClose}>
        <p className="text-sm leading-6 text-[var(--dim)]">برای ساخت رکورد، اول باید یک دامنه (زون) داشته باشید.</p>
        <button onClick={onNeedZone} className="mt-4 w-full rounded-lg bg-[#00b578] px-4 py-2.5 text-sm font-bold text-white">افزودن دامنه</button>
      </ModalShell>
    );
  }

  const hints: Record<string, string> = {
    A: "آدرس IPv4 — مثل 185.199.108.153",
    AAAA: "آدرس IPv6",
    CNAME: "نام دامنه مقصد — مثل target.example.com",
    MX: "سرور ایمیل — مثل mail.example.com",
    TXT: "متن تأیید یا SPF/DKIM",
    NS: "نیم‌سرور — مثل ns1.example.com",
    SRV: "به‌صورت: weight port target",
    CAA: "به‌صورت: 0 issue \"ca.example.net\"",
    PTR: "نام دامنه مقصد",
    SOA: "به‌صورت: primary-ns admin-email serial refresh retry expire minimum",
  };

  return (
    <ModalShell title={editing ? "ویرایش رکورد" : "رکورد جدید"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!editing && (
          <div>
            <label className={labelCls} htmlFor="rec-zone">دامنه (زون)</label>
            <select id="rec-zone" className={fieldCls} value={zoneId} onChange={(e) => setZoneId(Number(e.target.value))}>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="rec-type">نوع رکورد</label>
            <select id="rec-type" className={`${fieldCls} mono`} value={type} onChange={(e) => setType(e.target.value)}>
              {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rec-name">نام (ساب‌دامنه)</label>
            <input id="rec-name" dir="ltr" className={`${fieldCls} mono`} placeholder="@ یا www" value={name} onChange={(e) => setName(e.target.value)} required />
            <p className="mt-1 text-xs text-[var(--dim)]">@ یعنی خود دامنه اصلی</p>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="rec-content">مقدار</label>
          <input id="rec-content" dir="ltr" className={`${fieldCls} mono`} placeholder={hints[type] ?? ""} value={content} onChange={(e) => setContent(e.target.value)} required />
          <p className="mt-1 text-xs text-[var(--dim)]">{hints[type]}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="rec-ttl">TTL (ثانیه)</label>
            <select id="rec-ttl" className={`${fieldCls} mono`} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {TTL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {needsPriority && (
            <div>
              <label className={labelCls} htmlFor="rec-priority">اولویت (Priority)</label>
              <input id="rec-priority" type="number" min={0} max={65535} dir="ltr" className={`${fieldCls} mono`} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          )}
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={mut.isPending || !content.trim()} className="flex-1 rounded-lg bg-[#00b578] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
            {mut.isPending ? "در حال ذخیره…" : editing ? "ذخیره تغییرات" : "افزودن رکورد"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-[var(--surface2)] px-4 py-2.5 text-sm font-bold">انصراف</button>
        </div>
      </form>
    </ModalShell>
  );
}
