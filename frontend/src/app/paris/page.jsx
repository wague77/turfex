"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, RefreshCw, Check, X, Wallet, TrendingUp, TrendingDown, Coins } from "lucide-react";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/branding";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const PARI_TYPES = [
  { v: "SIMPLE_GAGNANT", l: "Simple Gagnant" },
  { v: "SIMPLE_PLACE", l: "Simple Placé" },
  { v: "COUPLE_ORDRE", l: "Couplé Ordre" },
  { v: "COUPLE", l: "Couplé Désordre" },
  { v: "TIERCE_ORDRE", l: "Tiercé Ordre" },
  { v: "TIERCE", l: "Tiercé Désordre" },
  { v: "QUARTE_PLUS", l: "Quarté+" },
  { v: "QUINTE_PLUS", l: "Quinté+" },
  { v: "TRIO", l: "Trio" },
  { v: "MULTI", l: "Multi" },
];

const todayDDMMYYYY = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;
};

const Paris = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // Formulaire ajout
  const [date, setDate] = useState(todayDDMMYYYY());
  const [reunion, setReunion] = useState("");
  const [course, setCourse] = useState("");
  const [typePari, setTypePari] = useState("SIMPLE_GAGNANT");
  const [chevaux, setChevaux] = useState("");
  const [mise, setMise] = useState(2);
  const [coteAffichee, setCoteAffichee] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/bets`);
      setItems(resp.data?.items || []);
    } catch (_) {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    const nums = chevaux.split(/[-,\s]+/).map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
    if (!nums.length) { toast.error("Saisis au moins un cheval"); return; }
    if (!mise || mise <= 0) { toast.error("Mise invalide"); return; }
    setAdding(true);
    try {
      await axios.post(`${API}/bets`, {
        date, reunion, course, typePari, chevaux: nums,
        mise: Number(mise),
        coteAffichee: coteAffichee ? Number(coteAffichee) : null,
        statut: "en_attente",
      });
      toast.success("Pari enregistré");
      setChevaux("");
      setCoteAffichee("");
      await load();
    } catch (_) {
      toast.error("Erreur");
    } finally {
      setAdding(false);
    }
  };

  const handleResult = async (bet, statut) => {
    let gainReel = 0;
    if (statut === "gagne") {
      const g = window.prompt(`Gain réel (en €) pour ce pari de ${bet.mise}€ :`, "");
      if (g === null) return;
      gainReel = Number(g) || 0;
    }
    try {
      await axios.patch(`${API}/bets/${bet.id}`, { statut, gainReel });
      toast.success(statut === "gagne" ? `+${gainReel}€ enregistrés` : "Pari marqué perdu");
      await load();
    } catch (_) {
      toast.error("Erreur");
    }
  };

  const handleDelete = async (bet) => {
    if (!window.confirm("Supprimer ce pari ?")) return;
    try {
      await axios.delete(`${API}/bets/${bet.id}`);
      setItems((prev) => prev.filter((x) => x.id !== bet.id));
      toast.success("Supprimé");
    } catch (_) {
      toast.error("Erreur");
    }
  };

  // Statistiques
  const stats = useMemo(() => {
    const settled = items.filter((b) => b.statut === "gagne" || b.statut === "perdu");
    const won = items.filter((b) => b.statut === "gagne");
    const totalMise = items.reduce((s, b) => s + (b.mise || 0), 0);
    const totalSettledMise = settled.reduce((s, b) => s + (b.mise || 0), 0);
    const totalGain = won.reduce((s, b) => s + (b.gainReel || 0), 0);
    const balance = totalGain - totalMise;
    const roi = totalSettledMise > 0 ? ((totalGain - totalSettledMise) / totalSettledMise) * 100 : 0;
    const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;

    // ROI par type de pari
    const byType = {};
    settled.forEach((b) => {
      if (!byType[b.typePari]) byType[b.typePari] = { mises: 0, gains: 0, count: 0, won: 0 };
      byType[b.typePari].mises += b.mise || 0;
      byType[b.typePari].gains += b.gainReel || 0;
      byType[b.typePari].count += 1;
      if (b.statut === "gagne") byType[b.typePari].won += 1;
    });
    Object.values(byType).forEach((t) => {
      t.roi = t.mises > 0 ? ((t.gains - t.mises) / t.mises) * 100 : 0;
      t.winRate = t.count > 0 ? (t.won / t.count) * 100 : 0;
    });

    return { totalBets: items.length, settled: settled.length, won: won.length,
             totalMise, totalGain, balance, roi, winRate, byType };
  }, [items]);

  return (
    <main className="min-h-screen bg-background py-6 px-4">
      <header className="max-w-6xl mx-auto mb-6 flex flex-wrap items-center gap-3">
        <Link href="/">
          <Button variant="outline" className="bg-white border-2 border-black">
            <ArrowLeft className="h-4 w-4 mr-1" /> Retour
          </Button>
        </Link>
        <h1 className="text-2xl font-extrabold italic flex-1">
          <span className="bg-gradient-to-r from-pink-500 to-cyan-500 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            {APP_NAME}
          </span>
          <span className="text-foreground"> — 💰 Tracker de paris réels</span>
        </h1>
        <Button onClick={load} disabled={loading} variant="outline" className="bg-white border-2 border-black">
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
        </Button>
      </header>

      {/* KPIs */}
      <section className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-black text-white border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase opacity-70">Paris totaux</div>
          <div className="text-3xl font-extrabold">{stats.totalBets}</div>
          <div className="text-[10px] opacity-70">{stats.settled} clôturés</div>
        </div>
        <div className="bg-orange-200 border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase font-bold">Total misé</div>
          <div className="text-2xl font-extrabold">{stats.totalMise.toFixed(0)}€</div>
        </div>
        <div className="bg-green-300 border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase font-bold">Total gagné</div>
          <div className="text-2xl font-extrabold">{stats.totalGain.toFixed(0)}€</div>
        </div>
        <div className={`border-2 border-black rounded p-3 text-center ${stats.balance >= 0 ? "bg-emerald-300" : "bg-red-300"}`}>
          <div className="text-[10px] uppercase font-bold">Balance</div>
          <div className="text-2xl font-extrabold flex items-center justify-center gap-1">
            {stats.balance >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {stats.balance >= 0 ? "+" : ""}{stats.balance.toFixed(0)}€
          </div>
        </div>
        <div className={`border-2 border-black rounded p-3 text-center ${stats.roi >= 0 ? "bg-yellow-300" : "bg-pink-300"}`}>
          <div className="text-[10px] uppercase font-bold">ROI</div>
          <div className="text-2xl font-extrabold">{stats.roi >= 0 ? "+" : ""}{stats.roi.toFixed(1)}%</div>
          <div className="text-[10px]">Win rate {stats.winRate.toFixed(0)}%</div>
        </div>
      </section>

      {/* Formulaire ajout */}
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Enregistrer un nouveau pari
        </h2>
        <form onSubmit={handleAdd} className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <div className="col-span-1">
            <Label className="text-[10px] font-bold">Date</Label>
            <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="JJMMAAAA" className="bg-white" />
          </div>
          <div className="col-span-1">
            <Label className="text-[10px] font-bold">Réunion</Label>
            <Input value={reunion} onChange={(e) => setReunion(e.target.value.toUpperCase())} placeholder="R1" className="bg-white" />
          </div>
          <div className="col-span-1">
            <Label className="text-[10px] font-bold">Course</Label>
            <Input value={course} onChange={(e) => setCourse(e.target.value.toUpperCase())} placeholder="C1" className="bg-white" />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-bold">Type de pari</Label>
            <Select value={typePari} onValueChange={setTypePari}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARI_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-bold">Chevaux (séparés par - ou ,)</Label>
            <Input value={chevaux} onChange={(e) => setChevaux(e.target.value)} placeholder="ex: 5-12-3" className="bg-white" />
          </div>
          <div className="col-span-1">
            <Label className="text-[10px] font-bold">Mise (€)</Label>
            <Input type="number" min="0.5" step="0.5" value={mise} onChange={(e) => setMise(e.target.value)} className="bg-white" />
          </div>
          <div className="col-span-1">
            <Label className="text-[10px] font-bold">Cote (info)</Label>
            <Input type="number" step="0.1" value={coteAffichee} onChange={(e) => setCoteAffichee(e.target.value)} placeholder="ex: 8.5" className="bg-white" />
          </div>
          <div className="col-span-2 md:col-span-7 flex justify-end">
            <Button type="submit" disabled={adding} className="bg-caf-green text-caf-green-foreground font-bold">
              <Plus className="h-4 w-4 mr-1" /> Enregistrer le pari
            </Button>
          </div>
        </form>
      </section>

      {/* Liste paris */}
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded overflow-hidden overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-row-pink text-white">
              <th className="border border-black px-2 py-1">Date</th>
              <th className="border border-black px-2 py-1">R/C</th>
              <th className="border border-black px-2 py-1">Type</th>
              <th className="border border-black px-2 py-1 text-left">Chevaux</th>
              <th className="border border-black px-2 py-1">Mise</th>
              <th className="border border-black px-2 py-1">Cote</th>
              <th className="border border-black px-2 py-1">Gain</th>
              <th className="border border-black px-2 py-1">Net</th>
              <th className="border border-black px-2 py-1">Statut</th>
              <th className="border border-black px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-muted-foreground italic">
                  Aucun pari enregistré pour l'instant.
                </td>
              </tr>
            )}
            {items.map((b) => {
              const net = (b.gainReel || 0) - (b.mise || 0);
              return (
                <tr key={b.id} className={b.statut === "gagne" ? "bg-green-50" : b.statut === "perdu" ? "bg-red-50 opacity-70" : "hover:bg-yellow-50"}>
                  <td className="border border-black px-2 py-1 text-center font-mono text-[10px]">{b.date}</td>
                  <td className="border border-black px-2 py-1 text-center font-bold">{b.reunion}/{b.course}</td>
                  <td className="border border-black px-2 py-1 text-center">{(PARI_TYPES.find((t) => t.v === b.typePari) || {}).l || b.typePari}</td>
                  <td className="border border-black px-2 py-1 font-bold font-mono">{b.chevaux.join(" - ")}</td>
                  <td className="border border-black px-2 py-1 text-center text-orange-700 font-bold">{b.mise.toFixed(1)}€</td>
                  <td className="border border-black px-2 py-1 text-center">{b.coteAffichee ?? "—"}</td>
                  <td className="border border-black px-2 py-1 text-center font-bold text-green-700">{b.gainReel != null ? `${b.gainReel.toFixed(1)}€` : "—"}</td>
                  <td className={`border border-black px-2 py-1 text-center font-extrabold ${net > 0 ? "text-green-700" : net < 0 ? "text-red-700" : ""}`}>
                    {b.statut === "en_attente" ? "—" : `${net >= 0 ? "+" : ""}${net.toFixed(1)}€`}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    {b.statut === "gagne" ? (
                      <span className="inline-flex items-center gap-1 bg-green-300 px-2 py-0.5 rounded font-bold">
                        <Check className="h-3 w-3" /> Gagné
                      </span>
                    ) : b.statut === "perdu" ? (
                      <span className="inline-flex items-center gap-1 bg-red-300 px-2 py-0.5 rounded font-bold">
                        <X className="h-3 w-3" /> Perdu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-yellow-300 px-2 py-0.5 rounded font-bold">
                        <Coins className="h-3 w-3" /> En attente
                      </span>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1">
                    <div className="flex items-center justify-center gap-1">
                      {b.statut === "en_attente" && (
                        <>
                          <Button onClick={() => handleResult(b, "gagne")} variant="ghost" size="icon" className="h-7 w-7 hover:bg-green-200" title="Marquer gagné">
                            <Check className="h-3 w-3 text-green-700" />
                          </Button>
                          <Button onClick={() => handleResult(b, "perdu")} variant="ghost" size="icon" className="h-7 w-7 hover:bg-red-200" title="Marquer perdu">
                            <X className="h-3 w-3 text-red-700" />
                          </Button>
                        </>
                      )}
                      <Button onClick={() => handleDelete(b)} variant="ghost" size="icon" className="h-7 w-7 hover:bg-red-200" title="Supprimer">
                        <Trash2 className="h-3 w-3 text-red-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ROI par type */}
      {Object.keys(stats.byType).length > 0 && (
        <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded mt-6 overflow-hidden">
          <div className="bg-black text-white px-3 py-2 font-bold flex items-center gap-2">
            <Wallet className="h-4 w-4" /> ROI par type de pari
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-row-pink text-white">
                <th className="border border-black px-2 py-1 text-left">Type</th>
                <th className="border border-black px-2 py-1">Paris</th>
                <th className="border border-black px-2 py-1">Misé</th>
                <th className="border border-black px-2 py-1">Gagné</th>
                <th className="border border-black px-2 py-1">% Réussite</th>
                <th className="border border-black px-2 py-1">ROI</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.byType).map(([type, t]) => (
                <tr key={type}>
                  <td className="border border-black px-2 py-1 font-bold">{(PARI_TYPES.find((p) => p.v === type) || {}).l || type}</td>
                  <td className="border border-black px-2 py-1 text-center">{t.count}</td>
                  <td className="border border-black px-2 py-1 text-center">{t.mises.toFixed(0)}€</td>
                  <td className="border border-black px-2 py-1 text-center text-green-700 font-bold">{t.gains.toFixed(0)}€</td>
                  <td className="border border-black px-2 py-1 text-center">{t.winRate.toFixed(0)}%</td>
                  <td className={`border border-black px-2 py-1 text-center font-extrabold ${t.roi >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {t.roi >= 0 ? "+" : ""}{t.roi.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
};

export default Paris;

