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
  Brain,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Database,
  Sparkles,
  AlertTriangle,
  Trash2,
} from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

export function AIUsagePanel({ token }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [clearing, setClearing] = useState(false);

  const headers = useMemo(() => (token ? { "X-Admin-Password": token } : {}), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/ai/usage`, { headers });
      setStats(data);
    } catch (e) {
      toast.error("Impossible de charger les stats IA", {
        description: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const clearCache = async () => {
    if (!window.confirm("Vider le cache IA ? Les prochaines analyses seront re-générées (et donc payantes).")) return;
    setClearing(true);
    try {
      const { data } = await axios.delete(`${API}/admin/ai/cache`, { headers });
      toast.success(`Cache vidé (${data.deleted || 0} entrées supprimées)`);
      await load();
    } catch (e) {
      toast.error("Erreur", { description: e?.response?.data?.detail || e.message });
    } finally {
      setClearing(false);
    }
  };

  const totals = stats?.totals || { calls: 0, real: 0, cached: 0, errors: 0 };
  const cacheHitRate = totals.calls > 0 ? Math.round((totals.cached / totals.calls) * 100) : 0;
  const dailyArr = Object.entries(stats?.daily || {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7);

  return (
    <section
      data-testid="ai-usage-panel"
      className="max-w-6xl mx-auto bg-white border-2 border-black rounded-xl p-4 mb-6"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            data-testid="ai-usage-toggle"
            className="w-full flex items-center justify-between gap-3 py-1 text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-600 to-pink-500 flex items-center justify-center text-white shadow">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <div className="font-extrabold text-lg">Usage IA — Claude Sonnet 4.5</div>
                <div className="text-xs text-gray-600">
                  Analyse de chevaux & top 8 · cache 24h actif · budget controlé
                </div>
              </div>
            </div>
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-4">
          {/* Top stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="border-2 border-violet-300 rounded-lg p-3 bg-violet-50" data-testid="ai-stat-calls">
              <div className="text-[10px] uppercase tracking-wider text-violet-700 font-bold">Appels 7j</div>
              <div className="text-2xl font-extrabold text-violet-900">{totals.calls}</div>
              <div className="text-[10px] text-violet-600">{totals.real} réels · {totals.cached} cache</div>
            </div>
            <div className="border-2 border-blue-300 rounded-lg p-3 bg-blue-50" data-testid="ai-stat-cache-rate">
              <div className="text-[10px] uppercase tracking-wider text-blue-700 font-bold">Cache hit rate</div>
              <div className="text-2xl font-extrabold text-blue-900">{cacheHitRate}%</div>
              <div className="text-[10px] text-blue-600">{stats?.cacheEntries || 0} entrées</div>
            </div>
            <div className="border-2 border-green-300 rounded-lg p-3 bg-green-50" data-testid="ai-stat-cost">
              <div className="text-[10px] uppercase tracking-wider text-green-700 font-bold">Coût estimé 7j</div>
              <div className="text-2xl font-extrabold text-green-900">
                ~{stats?.estimatedCostEur7d?.toFixed(2) || "0.00"} €
              </div>
              <div className="text-[10px] text-green-600">~{((stats?.estimatedCostEur7d || 0) * 30 / 7).toFixed(1)} €/mois est.</div>
            </div>
            <div
              className={`border-2 rounded-lg p-3 ${totals.errors > 0 ? "border-red-300 bg-red-50" : "border-gray-300 bg-gray-50"}`}
              data-testid="ai-stat-errors"
            >
              <div className="text-[10px] uppercase tracking-wider font-bold">
                {totals.errors > 0 ? "Erreurs" : "Erreurs"}
              </div>
              <div className={`text-2xl font-extrabold ${totals.errors > 0 ? "text-red-900" : "text-gray-700"}`}>
                {totals.errors}
              </div>
              <div className="text-[10px] text-gray-600">7 derniers jours</div>
            </div>
          </div>

          {/* Modèle + TTL info */}
          <div className="bg-gray-50 border border-gray-300 rounded p-2 text-xs flex flex-wrap gap-3 mb-4">
            <span><b>Modèle :</b> <code className="bg-white px-1 rounded">{stats?.model || "—"}</code></span>
            <span><b>Cache TTL :</b> {stats?.cacheTtlHours || 24}h</span>
            <span className="text-gray-500 italic">Coût estimé : ~0.006 €/appel réel (cache → 0 €)</span>
          </div>

          {/* Daily breakdown */}
          <div className="border-2 border-black rounded overflow-hidden mb-4">
            <div className="bg-black text-white px-3 py-2 text-xs uppercase font-bold tracking-wider">
              Détail par jour (7 derniers jours)
            </div>
            {dailyArr.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 italic">
                {loading ? "Chargement…" : "Aucune utilisation cette semaine."}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left px-3 py-1.5">Date</th>
                    <th className="text-right px-3 py-1.5">Total</th>
                    <th className="text-right px-3 py-1.5">Réels</th>
                    <th className="text-right px-3 py-1.5">Cache</th>
                    <th className="text-right px-3 py-1.5">Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyArr.map(([date, d], idx) => (
                    <tr key={date} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="px-3 py-1 font-mono">{date}</td>
                      <td className="px-3 py-1 text-right font-bold">{d.calls}</td>
                      <td className="px-3 py-1 text-right text-violet-700 flex items-center justify-end gap-1">
                        <Sparkles className="h-3 w-3" />
                        {d.real}
                      </td>
                      <td className="px-3 py-1 text-right text-blue-700 flex items-center justify-end gap-1">
                        <Database className="h-3 w-3" />
                        {d.cached}
                      </td>
                      <td className={`px-3 py-1 text-right ${d.errors > 0 ? "text-red-700 font-bold" : "text-gray-400"}`}>
                        {d.errors > 0 && <AlertTriangle className="h-3 w-3 inline mr-0.5" />}
                        {d.errors}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={load}
              disabled={loading}
              data-testid="ai-usage-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Rafraîchir
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearCache}
              disabled={clearing || !stats?.cacheEntries}
              className="text-red-700 border-red-300 hover:bg-red-50"
              data-testid="ai-usage-clear-cache"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Vider le cache
            </Button>
            <span className="text-[10px] text-gray-500 italic ml-auto">
              💡 Cache 24h économise ~80 % du coût LLM. Vide-le seulement si tu changes le prompt système.
            </span>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export default AIUsagePanel;

