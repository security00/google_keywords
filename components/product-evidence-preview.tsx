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
    <div className="self-start rounded-2xl border border-[#e6ebf1] bg-white p-4 mk-shadow-soft sm:p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-[#e6ebf1] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="text-sm font-semibold tracking-tight text-[#0a2540]">Reviewed signal queue</div>
          <div className="mt-1 text-xs text-[#6b7c93]">Anonymized product preview, no private customer data</div>
        </div>
        <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
          Updated weekly
        </span>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        {reviewStats.map((item) => (
          <div key={item.label} className={`rounded-lg border px-2 py-3 text-center ${statTone(item.tone)}`}>
            <div className="text-xl font-semibold leading-none">{item.value}</div>
            <div className="mt-1 truncate font-mono text-[10px] font-medium uppercase tracking-wider opacity-80">
              {item.label}
            </div>
          </div>
        ))}
      </div>

      <div className={`mt-4 grid gap-4 ${compact ? "" : "xl:grid-cols-[1fr_0.95fr]"}`}>
        <div className="rounded-xl border border-[#e6ebf1] bg-[#f6f9fc] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-sm font-semibold tracking-tight text-[#0a2540]">
                browser extension generator
              </div>
              <div className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">
                Tool keyword · 90d trend
              </div>
            </div>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              11.7x close
            </span>
          </div>
          <svg className="mt-5 h-28 w-full overflow-visible" viewBox="0 0 280 110" role="img">
            <title>Rising keyword interest preview</title>
            <defs>
              <linearGradient id="previewTrendLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#635bff" />
                <stop offset="55%" stopColor="#0073e6" />
                <stop offset="100%" stopColor="#00a3c4" />
              </linearGradient>
              <linearGradient id="previewTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#635bff" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#635bff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 90H280M0 60H280M0 30H280" stroke="#e6ebf1" strokeWidth="1" />
            <path
              d="M10 92C45 91 66 92 92 88C122 83 132 78 148 58C166 35 184 18 212 14C238 11 258 18 270 24L270 100H10Z"
              fill="url(#previewTrendFill)"
            />
            <path
              d="M10 92C45 91 66 92 92 88C122 83 132 78 148 58C166 35 184 18 212 14C238 11 258 18 270 24"
              fill="none"
              stroke="url(#previewTrendLine)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M10 91H270" stroke="#10b981" strokeDasharray="5 5" strokeWidth="1.5" opacity="0.55" />
            <circle cx="270" cy="24" r="4" fill="#635bff" />
          </svg>
          <div className="mt-3 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">
            <span>Recent movement</span>
            <span>Peak ratio 25x</span>
          </div>
        </div>

        <div className="rounded-xl border border-[#e6ebf1] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-md border border-[#635bff]/20 bg-[#635bff]/[0.06] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#635bff]">
              Review note
            </span>
            <SearchCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm leading-6 text-[#425466]">
            Intent looks tool-focused, demand is rising, and the SERP leaves room for a focused utility page.
          </p>
          <div className="mt-4 grid gap-2 text-xs text-[#425466]">
            <PreviewCheck icon={LineChart} text="Trend spike validated against baseline" />
            <PreviewCheck icon={BarChart3} text="SERP shape checked before approval" />
            <PreviewCheck icon={ShieldAlert} text="News, TV, celebrity, and trademark noise blocked" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-[#425466] sm:grid-cols-3">
        <PreviewPill icon={CheckCircle2} text="Human-reviewed" />
        <PreviewPill icon={Eye} text="Watchlist ready" />
        <PreviewPill icon={XCircle} text="Research spend protected" />
      </div>
    </div>
  );
}

function statTone(tone: string) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    sky: "border-[#00a3c4]/25 bg-[#00a3c4]/[0.07] text-[#0081a0]",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-[#635bff]/20 bg-[#635bff]/[0.06] text-[#635bff]",
    rose: "border-rose-200 bg-rose-50 text-rose-600",
  };

  return tones[tone] ?? tones.sky;
}

function PreviewCheck({ icon: Icon, text }: { icon: typeof LineChart; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 flex-none text-emerald-600" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function PreviewPill({ icon: Icon, text }: { icon: typeof CheckCircle2; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#e6ebf1] bg-[#f6f9fc] px-3 py-2">
      <Icon className="h-4 w-4 flex-none text-[#6b7c93]" aria-hidden="true" />
      <span className="truncate font-medium">{text}</span>
    </div>
  );
}
