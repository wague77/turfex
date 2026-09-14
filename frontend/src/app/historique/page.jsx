"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ArrowLeft, Trash2, Trophy, Target, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/branding";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const Historique = () => {
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

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/pronostics/${id}`);
      setItems((prev) => prev.filter((x) => x.id !== id));
      toast.success("Supprimé");
    } catch (_) {
      toast.error("Erreur suppression");
    }
  };

  // Stats globales
  const finished = items.filter((x) => x.arrivee && x.arrivee.length > 0);
  const totalTierceHits = finished.reduce((s, x) => s + (x.tierceHits || 0), 0);
  const totalTierce = finished.length * 3;
  const totalTop7Hits = finished.reduce((s, x) => s + (x.top7Hits || 0), 0);
  const totalTop7 = finished.reduce((s, x) => s + Math.min(7, x.arrivee?.length || 0), 0);
  const tiercePct = totalTierce > 0 ? Math.round((totalTierceHits / totalTierce) * 100) : 0;
  const top7Pct = totalTop7 > 0 ? Math.round((totalTop7Hits / totalTop7) * 100) : 0;

  return (
    <main className="min-h-screen bg-background py-6 px-4">
      <header className="max-w-6xl mx-auto mb-6 flex items-center gap-3">
        <a href="/">
          <Button variant="outline" className="bg-white border-2 border-black">
            <ArrowLeft className="h-4 w-4 mr-1" /> Retour
          </Button>
        </a>
        <h1 className="text-2xl font-extrabold italic tracking-wide flex-1">
          <span className="bg-gradient-to-r from-pink-500 to-cyan-500 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            {APP_NAME}
          </span>
          <span className="text-foreground"> — Historique des pronostics</span>
        </h1>
        <Button
          onClick={load}
          variant="outline"
          className="bg-white border-2 border-black"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
        </Button>
      </header>

      <section className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-black text-white border-2 border-black rounded p-4 text-center">
          <div className="text-xs uppercase opacity-70">Pronostics</div>
          <div className="text-3xl font-extrabold">{items.length}</div>
          <div className="text-xs opacity-70 mt-1">{finished.length} avec arrivée</div>
        </div>
        <div className="bg-yellow-300 border-2 border-black rounded p-4 text-center">
          <div className="text-xs uppercase font-bold flex items-center justify-center gap-1">
            <Target className="h-3 w-3" /> Tiercé CAF
          </div>
          <div className="text-3xl font-extrabold">{tiercePct}%</div>
          <div className="text-xs">{totalTierceHits}/{totalTierce}</div>
        </div>
        <div className="bg-caf-green text-caf-green-foreground border-2 border-black rounded p-4 text-center">
          <div className="text-xs uppercase font-bold flex items-center justify-center gap-1">
            <Trophy className="h-3 w-3" /> Top 7 CAF
          </div>
          <div className="text-3xl font-extrabold">{top7Pct}%</div>
          <div className="text-xs">{totalTop7Hits}/{totalTop7}</div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto bg-surface border-2 border-black overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-row-pink text-white">
              <th className="border border-black px-2 py-1 text-left">Date</th>
              <th className="border border-black px-2 py-1">R/C</th>
              <th className="border border-black px-2 py-1 text-left">Course</th>
              <th className="border border-black px-2 py-1">Top 3 CAF</th>
              <th className="border border-black px-2 py-1">Arrivée</th>
              <th className="border border-black px-2 py-1">Tiercé</th>
              <th className="border border-black px-2 py-1">Top 7</th>
              <th className="border border-black px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground italic">
                  Aucun pronostic enregistré. Utilise "Réunion entière" sur la page principale pour sauvegarder.
                </td>
              </tr>
            )}
            {items.map((it) => {
              const top3 = (it.classement || []).slice(0, 3);
              const arrTop3 = (it.arrivee || []).slice(0, 3);
              return (
                <tr key={it.id} className="hover:bg-yellow-100/40 transition-colors">
                  <td className="border border-black px-2 py-1 font-mono text-xs">{it.date}</td>
                  <td className="border border-black px-2 py-1 text-center font-bold">
                    {it.reunion}/{it.course}
                  </td>
                  <td className="border border-black px-2 py-1 text-xs">{it.courseInfo || "—"}</td>
                  <td className="border border-black px-2 py-1 text-center">
                    {top3.length > 0 ? top3.join(" - ") : "—"}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    {arrTop3.length > 0 ? (
                      <span className="font-bold">{arrTop3.join(" - ")}</span>
                    ) : (
                      <span className="text-muted-foreground italic">non terminée</span>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    {it.arrivee?.length > 0 ? (
                      <span className={`font-bold px-2 py-0.5 rounded ${it.tierceHits >= 2 ? "bg-green-300" : it.tierceHits >= 1 ? "bg-yellow-300" : "bg-red-200"}`}>
                        {it.tierceHits}/3
                      </span>
                    ) : "—"}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    {it.arrivee?.length > 0 ? (
                      <span className="font-bold">{it.top7Hits}/{Math.min(7, it.arrivee.length)}</span>
                    ) : "—"}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    <Button
                      onClick={() => handleDelete(it.id)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-red-200"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default Historique;

