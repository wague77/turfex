"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  History,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Zap,
  Clock,
  ExternalLink,
} from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const JOB_LABELS = {
  r1_pronostics: { label: "Pronostics R1 quotidiens", hourParis: "08h00", emoji: "🏁" },
  trial_followup: { label: "Relance trials J+2", hourParis: "10h00", emoji: "🎯" },
  daily_digest: { label: "Digest quotidien", hourParis: "11h00", emoji: "📊" },
  weekly_digest: { label: "Digest hebdomadaire (lundi)", hourParis: "11h00", emoji: "📈" },
};

const TRIGGER_COLORS = {
  cron: "bg-blue-200 text-blue-900 border-blue-600",
  manual: "bg-violet-200 text-violet-900 border-violet-600",
  startup_catchup: "bg-amber-200 text-amber-900 border-amber-600",
  external_cron: "bg-green-200 text-green-900 border-green-600",
};

const TRIGGER_LABELS = {
  cron: "cron interne",
  manual: "manuel",
  startup_catchup: "rattrapage",
  external_cron: "cron externe",
};

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DigestHistoryPanel({ token }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [lastSuccessByJob, setLastSuccessByJob] = useState({});
  const [countByJob, setCountByJob] = useState({});
  const [cronConfigured, setCronConfigured] = useState(false);
  const [cronTokenPreview, setCronTokenPreview] = useState("");
  const [copied, setCopied] = useState("");
  const [filterJob, setFilterJob] = useState("");

  const authHeaders = useMemo(() => (token ? { "X-Admin-Password": token } : {}), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "30" });
      if (filterJob) qs.set("job", filterJob);
      const { data } = await axios.get(`${API}/admin/notifications/digest/history?${qs.toString()}`, {
        headers: authHeaders,
      });
      setItems(data.items || []);
      setLastSuccessByJob(data.lastSuccessByJob || {});
      setCountByJob(data.countByJob || {});
      setCronConfigured(!!data.cronConfigured);
      setCronTokenPreview(data.cronTokenPreview || "");
    } catch (e) {
      toast.error("Impossible de charger l'historique", {
        description: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, filterJob]);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success("Copié !");
      setTimeout(() => setCopied(""), 1800);
    } catch {
      toast.error("Copie impossible");
    }
  };

  const cronUrls = useMemo(() => {
    if (!cronConfigured) return null;
    return {
      r1: `${BACKEND_URL}/api/cron/r1-pronostics?token=<CRON_TOKEN>`,
      trial: `${BACKEND_URL}/api/cron/trial-followup?token=<CRON_TOKEN>`,
    };
  }, [cronConfigured]);

  const filteredJobs = Object.keys(JOB_LABELS);

  return (
    <section
      data-testid="digest-history-panel"
      className="max-w-6xl mx-auto bg-white border-2 border-black rounded-xl p-4 mb-6"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            data-testid="digest-history-toggle"
            className="w-full flex items-center justify-between gap-3 py-1 text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center text-white shadow">
                <History className="h-5 w-5" />
              </div>
              <div>
                <div className="font-extrabold text-lg">Historique envois digests</div>
                <div className="text-xs text-gray-600">
                  Audit CRON + rattrapage (persistance DB) · {cronConfigured ? (
                    <span className="text-green-700 font-semibold">CRON externe configuré ✓</span>
                  ) : (
                    <span className="text-amber-700 font-semibold">CRON_TOKEN absent</span>
                  )}
                </div>
              </div>
            </div>
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-4">
          {/* Derniers succès par job */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {filteredJobs.map((jobKey) => {
              const meta = JOB_LABELS[jobKey];
              const last = lastSuccessByJob[jobKey];
              const count = countByJob[jobKey] || 0;
              return (
                <div
                  key={jobKey}
                  data-testid={`job-card-${jobKey}`}
                  className="border-2 border-black rounded-lg p-3 bg-gradient-to-br from-gray-50 to-white"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="text-xs font-bold uppercase text-gray-600">
                      {meta.emoji} {meta.label}
                    </div>
                    <div className="text-[10px] text-gray-500">{meta.hourParis}</div>
                  </div>
                  {last ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-1 text-xs text-green-700 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Dernier succès
                      </div>
                      <div className="text-xs text-gray-700 mt-0.5">{formatDate(last.runAt)}</div>
                      <div className="text-[11px] text-gray-500">
                        {last.sent ?? 0} envois · {TRIGGER_LABELS[last.trigger] || last.trigger}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-gray-500 italic">Aucun succès</div>
                  )}
                  <div className="text-[10px] text-gray-500 mt-1">Total runs: {count}</div>
                </div>
              );
            })}
          </div>

          {/* CRON externe URLs */}
          {cronUrls && (
            <div className="mb-5 bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-blue-700" />
                <span className="font-bold text-sm text-blue-900">
                  URLs CRON externe (cron-job.org, GitHub Actions, UptimeRobot)
                </span>
                <span className="text-[10px] bg-blue-200 px-2 py-0.5 rounded font-mono">
                  token: {cronTokenPreview || "—"}
                </span>
              </div>
              <p className="text-xs text-blue-800 mb-2">
                Remplace <code className="bg-blue-100 px-1 rounded">&lt;CRON_TOKEN&gt;</code> par la valeur de la variable
                <code className="bg-blue-100 px-1 rounded mx-1">CRON_TOKEN</code> de ton <code>.env</code>.
                Ping à 08h05 (R1) et 10h05 (Trial) Paris.
              </p>
              <div className="space-y-2">
                {[
                  { key: "r1", label: "R1 quotidiens", url: cronUrls.r1 },
                  { key: "trial", label: "Relance trials", url: cronUrls.trial },
                ].map((r) => (
                  <div
                    key={r.key}
                    data-testid={`cron-url-row-${r.key}`}
                    className="flex items-center gap-2 bg-white border border-blue-200 rounded px-2 py-1"
                  >
                    <span className="text-[11px] font-semibold text-blue-900 min-w-[110px]">{r.label}</span>
                    <code className="text-[11px] font-mono flex-1 truncate text-gray-700">{r.url}</code>
                    <Button
                      data-testid={`cron-url-copy-${r.key}`}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => copyToClipboard(r.url, r.key)}
                    >
                      {copied === r.key ? (
                        <Check className="h-3.5 w-3.5 text-green-700" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filtres + refresh */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-bold text-gray-700">Filtre :</span>
            <button
              data-testid="filter-all"
              onClick={() => setFilterJob("")}
              className={`text-xs px-2 py-1 rounded border-2 ${
                filterJob === "" ? "bg-black text-white border-black" : "bg-white border-gray-300"
              }`}
            >
              Tous
            </button>
            {filteredJobs.map((k) => (
              <button
                key={k}
                data-testid={`filter-${k}`}
                onClick={() => setFilterJob(k)}
                className={`text-xs px-2 py-1 rounded border-2 ${
                  filterJob === k ? "bg-black text-white border-black" : "bg-white border-gray-300"
                }`}
              >
                {JOB_LABELS[k].emoji} {k}
              </button>
            ))}
            <div className="flex-1" />
            <Button
              data-testid="digest-history-refresh"
              size="sm"
              variant="outline"
              onClick={load}
              disabled={loading}
              className="h-8 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Rafraîchir
            </Button>
          </div>

          {/* Liste des runs */}
          <div className="border-2 border-black rounded-lg overflow-hidden">
            <div className="grid grid-cols-[130px_1fr_90px_70px_60px_1fr] gap-2 bg-black text-white text-[10px] uppercase font-bold px-3 py-2">
              <div>Date/heure</div>
              <div>Job</div>
              <div>Trigger</div>
              <div>OK</div>
              <div>Envois</div>
              <div className="truncate">Erreur / Détail</div>
            </div>
            {items.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 italic">
                {loading ? "Chargement…" : "Aucun run enregistré pour ce filtre."}
              </div>
            ) : (
              items.map((it, idx) => {
                const jobMeta = JOB_LABELS[it.jobName] || { label: it.jobName, emoji: "•" };
                const triggerCls = TRIGGER_COLORS[it.trigger] || "bg-gray-200 text-gray-800 border-gray-400";
                return (
                  <div
                    key={it.id || idx}
                    data-testid={`run-row-${idx}`}
                    className={`grid grid-cols-[130px_1fr_90px_70px_60px_1fr] gap-2 items-center px-3 py-2 text-[11px] border-t border-gray-200 ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                    }`}
                  >
                    <div className="text-gray-700 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(it.runAt)}
                    </div>
                    <div className="font-semibold">
                      {jobMeta.emoji} {jobMeta.label}
                    </div>
                    <div>
                      <span className={`inline-block px-1.5 py-0.5 border rounded text-[10px] font-bold uppercase ${triggerCls}`}>
                        {TRIGGER_LABELS[it.trigger] || it.trigger || "?"}
                      </span>
                    </div>
                    <div>
                      {it.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                    <div className="font-mono text-center">{it.sent ?? 0}</div>
                    <div className="truncate text-gray-600 italic" title={it.error || ""}>
                      {it.error || (it.ok ? `${it.coursesCount || 0} courses · ${it.recipientsCount ?? "?"} dest.` : "—")}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Help link */}
          <div className="mt-4 text-xs text-gray-600 flex items-center gap-2">
            <ExternalLink className="h-3.5 w-3.5" />
            Si ton pod dort la nuit, configure un CRON externe gratuit sur{" "}
            <a
              href="https://cron-job.org"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-blue-700 underline"
            >
              cron-job.org
            </a>{" "}
            pour garantir l'envoi quotidien.
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export default DigestHistoryPanel;

