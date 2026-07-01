import { BarChart3, CheckCircle2, Eye, LineChart, SearchCheck, ShieldAlert, XCircle } from "lucide-react";

const reviewStats = [
  { label: "Passed", value: "12", tone: "emerald" },
  { label: "Queued", value: "8", tone: "sky" },
  { label: "Close", value: "4", tone: "amber" },
  { label: "Watch", value: "6", tone: "blue" },
  { label: "Rejected", value: "31", tone: "rose" },
];

export function ProductEvidencePreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className="self-start rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="text-sm font-semibold text-zinc-950">Reviewed signal queue</div>
          <div className="mt-1 text-xs text-zinc-500">Anonymized product preview, no private customer data</div>
        </div>
        <span className="w-fit rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
          Shared cache
        </span>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        {reviewStats.map((item) => (
          <div key={item.label} className={`rounded-lg px-2 py-3 text-center ${statTone(item.tone)}`}>
            <div className="text-xl font-semibold leading-none">{item.value}</div>
            <div className="mt-1 truncate text-[11px] font-medium">{item.label}</div>
          </div>
        ))}
      </div>

      <div className={`mt-4 grid gap-4 ${compact ? "" : "xl:grid-cols-[1fr_0.95fr]"}`}>
        <div className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-950">browser extension generator</div>
              <div className="mt-1 text-xs text-zinc-500">Tool keyword · 90d trend</div>
            </div>
            <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
              11.7x close
            </span>
          </div>
          <svg className="mt-5 h-28 w-full overflow-visible" viewBox="0 0 280 110" role="img">
            <title>Rising keyword interest preview</title>
            <path d="M0 90H280M0 60H280M0 30H280" stroke="#e4e4e7" strokeWidth="1" />
            <path d="M10 92C45 91 66 92 92 88C122 83 132 78 148 58C166 35 184 18 212 14C238 11 258 18 270 24" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
            <path d="M10 92C45 91 66 92 92 88C122 83 132 78 148 58C166 35 184 18 212 14C238 11 258 18 270 24L270 100H10Z" fill="#dbeafe" opacity="0.65" />
            <path d="M10 91H270" stroke="#84cc16" strokeDasharray="5 5" strokeWidth="2" />
          </svg>
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>Recent movement</span>
            <span>Peak ratio 25x</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">Review note</span>
            <SearchCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            Intent looks tool-focused, demand is rising, and the SERP leaves room for a focused utility page.
          </p>
          <div className="mt-4 grid gap-2 text-xs text-zinc-600">
            <PreviewCheck icon={LineChart} text="Trend spike validated against baseline" />
            <PreviewCheck icon={BarChart3} text="SERP shape checked before approval" />
            <PreviewCheck icon={ShieldAlert} text="News, TV, celebrity, and trademark noise blocked" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-zinc-600 sm:grid-cols-3">
        <PreviewPill icon={CheckCircle2} text="Human-reviewed" />
        <PreviewPill icon={Eye} text="Watchlist ready" />
        <PreviewPill icon={XCircle} text="Paid calls guarded" />
      </div>
    </div>
  );
}

function statTone(tone: string) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-800",
    sky: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
    blue: "bg-blue-50 text-blue-800",
    rose: "bg-rose-50 text-rose-800",
  };

  return tones[tone] ?? tones.sky;
}

function PreviewCheck({ icon: Icon, text }: { icon: typeof LineChart; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 flex-none text-emerald-700" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function PreviewPill({ icon: Icon, text }: { icon: typeof CheckCircle2; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-[#fbfbf8] px-3 py-2">
      <Icon className="h-4 w-4 flex-none text-zinc-500" aria-hidden="true" />
      <span className="truncate font-medium">{text}</span>
    </div>
  );
}
