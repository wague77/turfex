"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, TrendingUp, Target, Trophy } from "lucide-react";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/branding";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const Stats = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/pronostics`);
      setItems(resp.data?.items || []);
    } catch (_) {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const finished = items.filter((x) => x.arrivee && x.arrivee.length > 0);
    const totalFinished = finished.length;

    // Tiercé : top 3 CAF dans tiercé arrivée
    const tierceHits = finished.reduce((s, x) => s + (x.tierceHits || 0), 0);
    const tierceMax = totalFinished * 3;
    const tiercePct = tierceMax > 0 ? (tierceHits / tierceMax) * 100 : 0;

    // Top 7
    const top7Hits = finished.reduce((s, x) => s + (x.top7Hits || 0), 0);
    const top7Max = finished.reduce((s, x) => s + Math.min(7, x.arrivee?.length || 0), 0);
    const top7Pct = top7Max > 0 ? (top7Hits / top7Max) * 100 : 0;

    // Tiercé exact (3 premiers CAF = arrivée top 3 dans n'importe quel ordre)
    const tierceCompletDesordre = finished.filter((x) => {
      const top3Caf = (x.classement || []).slice(0, 3);
      const top3Arr = (x.arrivee || []).slice(0, 3);
      return top3Arr.every((n) => top3Caf.includes(n));
    }).length;

    // Quinté+ : 5 premiers CAF dans 5 premiers arrivée
    const quinteScore = finished.reduce((s, x) => {
      const top5Caf = (x.classement || []).slice(0, 5);
      const top5Arr = (x.arrivee || []).slice(0, 5);
      return s + top5Arr.filter((n) => top5Caf.includes(n)).length;
    }, 0);
    const quinteMax = finished.reduce((s, x) => s + Math.min(5, x.arrivee?.length || 0), 0);
    const quintePct = quinteMax > 0 ? (quinteScore / quinteMax) * 100 : 0;

    // 1er CAF gagnant
    const firstCafWinner = finished.filter((x) => {
      const top = (x.classement || [])[0];
      const winner = (x.arrivee || [])[0];
      return top && winner && top === winner;
    }).length;
    const firstCafWinnerPct = totalFinished > 0 ? (firstCafWinner / totalFinished) * 100 : 0;

    // Heatmap par hippodrome
    const byHippo = {};
    finished.forEach((x) => {
      const info = x.courseInfo || "";
      const match = info.match(/•\s*([^•]+)\s*•/);
      const hippo = match ? match[1].trim() : "Inconnu";
      if (!byHippo[hippo]) byHippo[hippo] = { total: 0, hits: 0, top1: 0 };
      byHippo[hippo].total += 3;
      byHippo[hippo].hits += x.tierceHits || 0;
      const top = (x.classement || [])[0];
      const winner = (x.arrivee || [])[0];
      if (top && winner && top === winner) byHippo[hippo].top1 += 1;
    });

    return {
      totalSaved: items.length,
      totalFinished,
      tiercePct, tierceHits, tierceMax,
      top7Pct, top7Hits, top7Max,
      tierceCompletDesordre,
      quintePct, quinteScore, quinteMax,
      firstCafWinner, firstCafWinnerPct,
      byHippo,
    };
  }, [items]);

  // Bar chart simple SVG
  const BarChart = ({ value, max = 100, color = "#16a34a", height = 32 }) => {
    const w = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className="bg-gray-200 rounded h-full" style={{ height }}>
        <div className="h-full rounded transition-all duration-500" style={{ width: `${w}%`, background: color }} />
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-background py-6 px-4">
      <header className="max-w-6xl mx-auto mb-6 flex items-center gap-3 flex-wrap">
        <a href="/">
          <Button variant="outline" className="bg-white border-2 border-black">
            <ArrowLeft className="h-4 w-4 mr-1" /> Retour
          </Button>
        </a>
        <h1 className="text-2xl font-extrabold italic flex-1">
          <span className="bg-gradient-to-r from-pink-500 to-cyan-500 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            {APP_NAME}
          </span>
          <span className="text-foreground"> — 📊 Statistiques & Backtesting</span>
        </h1>
        <Button onClick={load} disabled={loading} variant="outline" className="bg-white border-2 border-black">
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
        </Button>
      </header>

      {/* KPIs */}
      <section className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-black text-white border-2 border-black rounded p-3 text-center">
          <div className="text-xs uppercase opacity-80">Pronostics totaux</div>
          <div className="text-3xl font-extrabold">{stats.totalSaved}</div>
          <div className="text-xs opacity-70">{stats.totalFinished} terminés</div>
        </div>
        <div className="bg-yellow-300 border-2 border-black rounded p-3 text-center">
          <div className="text-xs uppercase font-bold">🎯 Tiercé CAF</div>
          <div className="text-3xl font-extrabold">{Math.round(stats.tiercePct)}%</div>
          <div className="text-xs">{stats.tierceHits}/{stats.tierceMax}</div>
        </div>
        <div className="bg-emerald-300 border-2 border-black rounded p-3 text-center">
          <div className="text-xs uppercase font-bold">🏆 Top 7</div>
          <div className="text-3xl font-extrabold">{Math.round(stats.top7Pct)}%</div>
          <div className="text-xs">{stats.top7Hits}/{stats.top7Max}</div>
        </div>
        <div className="bg-pink-300 border-2 border-black rounded p-3 text-center">
          <div className="text-xs uppercase font-bold">⭐ 1er CAF gagnant</div>
          <div className="text-3xl font-extrabold">{Math.round(stats.firstCafWinnerPct)}%</div>
          <div className="text-xs">{stats.firstCafWinner}/{stats.totalFinished}</div>
        </div>
      </section>

      {/* Détails performances */}
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Performances détaillées
        </h2>
        <div className="space-y-3">
          {[
            { label: "Tiercé exact (3/3 dans le tiercé)", val: stats.tierceCompletDesordre, max: stats.totalFinished, color: "#dc2626", suffix: ` / ${stats.totalFinished}` },
            { label: "Top 3 CAF présents dans le tiercé", val: Math.round(stats.tiercePct), max: 100, color: "#facc15", suffix: "%" },
            { label: "Top 5 CAF présents dans le quinté+", val: Math.round(stats.quintePct), max: 100, color: "#22c55e", suffix: "%" },
            { label: "Top 7 CAF présents dans l'arrivée", val: Math.round(stats.top7Pct), max: 100, color: "#3b82f6", suffix: "%" },
            { label: "1er CAF = vainqueur", val: Math.round(stats.firstCafWinnerPct), max: 100, color: "#a855f7", suffix: "%" },
          ].map((row, i) => (
            <div key={i} className="grid grid-cols-[260px_1fr_80px] gap-3 items-center">
              <div className="text-sm font-bold">{row.label}</div>
              <BarChart value={row.val} max={row.max} color={row.color} height={20} />
              <div className="text-sm font-bold text-right">{row.val}{row.suffix}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Heatmap par hippodrome */}
      {Object.keys(stats.byHippo).length > 0 && (
        <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded overflow-hidden">
          <h2 className="font-bold text-lg p-3 border-b-2 border-black flex items-center gap-2">
            <Target className="h-5 w-5" />
            Performance par hippodrome
          </h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-row-pink text-white">
                <th className="border border-black px-2 py-1 text-left">Hippodrome</th>
                <th className="border border-black px-2 py-1">Pronostics</th>
                <th className="border border-black px-2 py-1">Tiercé CAF</th>
                <th className="border border-black px-2 py-1">1ers CAF gagnants</th>
                <th className="border border-black px-2 py-1">Taux réussite</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byHippo)
                .sort((a, b) => b[1].hits - a[1].hits)
                .map(([hippo, h]) => {
                  const pct = h.total > 0 ? (h.hits / h.total) * 100 : 0;
                  return (
                    <tr key={hippo}>
                      <td className="border border-black px-2 py-1 font-bold">{hippo}</td>
                      <td className="border border-black px-2 py-1 text-center">{h.total / 3}</td>
                      <td className="border border-black px-2 py-1 text-center">{h.hits}/{h.total}</td>
                      <td className="border border-black px-2 py-1 text-center">{h.top1}</td>
                      <td className="border border-black px-2 py-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded h-2 overflow-hidden">
                            <div
                              className="h-full"
                              style={{
                                width: `${pct}%`,
                                background: pct > 50 ? "#22c55e" : pct > 30 ? "#facc15" : "#dc2626",
                              }}
                            />
                          </div>
                          <span className="font-bold text-xs">{Math.round(pct)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
};

export default Stats;

