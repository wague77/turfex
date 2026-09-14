"use client";

/**
 * TurfxZonesPanel — Analyse VALUE en 3 zones (A/B/C).
 *
 * Inspirée de Turf-France, mais 100% TURFEX-native :
 *   - Calcule en backend les indicateurs CX/RTX/OR/IDC/CFP/RATIO
 *   - Répartit les chevaux en 3 zones selon la cote (A=favoris, C=outsiders)
 *   - Identifie automatiquement le top value, le top potentiel et les chevaux à éviter
 *   - Filtres rapides : Tout / Top Value / Top CFP / Chevaux à éviter
 *   - Comparateur duel entre 2 chevaux
 */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Diamond,
  Target,
  Skull,
  Crown,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Trophy,
  Filter,
  X,
  Swords,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const ZONE_META = {
  A: { label: "Zone A — Favoris", color: "from-emerald-500 to-cyan-500", desc: "Top tiers du marché PMU (cotes les plus basses)" },
  B: { label: "Zone B — Milieu", color: "from-amber-500 to-orange-500", desc: "Cotes intermédiaires, potentiel mixte" },
  C: { label: "Zone C — Outsiders", color: "from-fuchsia-500 to-rose-500", desc: "Cotes élevées, surprises possibles" },
};

const FILTERS = [
  { key: "all", label: "Tout voir", icon: Diamond },
  { key: "value", label: "Top Value", icon: Crown },
  { key: "potential", label: "Top CFP", icon: TrendingUp },
  { key: "avoid", label: "À éviter", icon: Skull },
];

function ratioLabel(r) {
  if (!r || r <= 0) return { txt: "—", cls: "text-gray-400" };
  if (r > 20) return { txt: "TRÈS VALUE", cls: "text-emerald-400 font-bold" };
  if (r >= 10) return { txt: "VALUE", cls: "text-cyan-400 font-bold" };
  if (r >= 5) return { txt: "CORRECT", cls: "text-amber-400" };
  return { txt: "SURCOTÉ", cls: "text-rose-400 font-bold" };
}

function StarBadge({ kind }) {
  if (kind === "value") return <span title="Top Value du jour" className="ml-1 text-yellow-300">★</span>;
  if (kind === "potential") return <span title="Top potentiel CFP" className="ml-1 text-cyan-300">◆</span>;
  if (kind === "avoid") return <span title="Cheval à éviter" className="ml-1 text-rose-400">⚠</span>;
  return null;
}

function HeroCard({ icon: Icon, label, horse, accentClass, ratioClass }) {
  if (!horse) return null;
  return (
    <div className={`relative overflow-hidden rounded-xl border-2 border-black/40 ${accentClass} text-white p-4 shadow-2xl`}>
      <div className="absolute -right-4 -top-4 opacity-20">
        <Icon className="h-24 w-24" />
      </div>
      <div className="relative z-10">
        <div className="text-[10px] uppercase tracking-widest font-bold opacity-90">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-black">N°{horse.num}</span>
          <span className="text-lg font-bold truncate">{horse.nom}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {horse.ratio != null && (
            <div className={`px-2 py-0.5 rounded bg-black/40 backdrop-blur ${ratioClass || ""}`}>
              RATIO <b>{horse.ratio}</b>
            </div>
          )}
          {horse.cfp != null && (
            <div className="px-2 py-0.5 rounded bg-black/40 backdrop-blur">
              CFP <b>{horse.cfp.toLocaleString("fr-FR")}</b>
            </div>
          )}
          {horse.cote != null && (
            <div className="px-2 py-0.5 rounded bg-black/40 backdrop-blur">
              Cote <b>{horse.cote}</b>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HorseRow({ h, onPick, isPicked, dim }) {
  const { txt, cls } = ratioLabel(h.ratio);
  return (
    <tr className={`border-b border-white/10 hover:bg-white/5 transition-colors ${dim ? "opacity-40" : ""} ${isPicked ? "bg-fuchsia-500/20" : ""}`}>
      <td className="px-2 py-2 font-black text-yellow-300 text-base">
        {h.num}
        {h.isTopValue && <StarBadge kind="value" />}
        {h.isTopPotential && <StarBadge kind="potential" />}
        {h.isToAvoid && <StarBadge kind="avoid" />}
      </td>
      <td className="px-2 py-2 font-bold text-white truncate max-w-[180px]" title={h.nom}>{h.nom}</td>
      <td className="px-2 py-2 text-center text-xs text-white/70">{h.age}<span className="text-white/40">{h.sexe}</span></td>
      <td className="px-2 py-2 text-xs text-white/60 font-mono max-w-[120px] truncate" title={h.musique}>{h.musique || "—"}</td>
      <td className="px-2 py-2 text-xs text-white/70 truncate max-w-[120px]" title={h.driver}>{h.driver || "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-cyan-300">{h.cote != null ? h.cote.toFixed(1) : "—"}</td>
      <td className="px-2 py-2 text-right font-mono text-white/80">{h.cx}</td>
      <td className="px-2 py-2 text-right font-mono text-white/80">{h.rtx}</td>
      <td className="px-2 py-2 text-right font-mono text-white/80">{h.or}</td>
      <td className="px-2 py-2 text-right font-mono text-white/80">{h.idc?.toFixed?.(1) ?? h.idc}</td>
      <td className="px-2 py-2 text-right font-mono font-bold text-amber-300">{h.cfp.toLocaleString("fr-FR")}</td>
      <td className={`px-2 py-2 text-right font-mono font-black ${cls}`}>
        {h.ratio || "—"}
        <div className="text-[8px] uppercase tracking-wider opacity-80">{txt}</div>
      </td>
      <td className="px-1 py-2 text-center">
        <button
          onClick={() => onPick(h)}
          className={`w-6 h-6 rounded-full border-2 transition-all ${isPicked ? "bg-fuchsia-500 border-white scale-110" : "border-white/30 hover:border-fuchsia-400"}`}
          title="Comparer"
          data-testid={`zone-pick-${h.num}`}
        >
          {isPicked && <Swords className="h-3 w-3 mx-auto text-white" />}
        </button>
      </td>
    </tr>
  );
}

function ZoneTable({ zoneKey, horses, filter, summary, onPick, picked }) {
  const meta = ZONE_META[zoneKey];
  if (!horses || horses.length === 0) return null;
  return (
    <div className="mb-6">
      <div className={`px-4 py-2 rounded-t-lg bg-gradient-to-r ${meta.color} text-white font-black text-sm flex items-center justify-between`}>
        <span>{meta.label} <span className="opacity-80 font-normal text-xs ml-2">{meta.desc}</span></span>
        <span className="bg-black/30 px-2 py-0.5 rounded text-xs">{horses.length} chevaux</span>
      </div>
      <div className="overflow-x-auto bg-slate-900/80 backdrop-blur border-x-2 border-b-2 border-white/10 rounded-b-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/80 sticky top-0">
            <tr className="text-[10px] uppercase tracking-wider text-white/60 border-b border-white/10">
              <th className="px-2 py-2 text-left">N°</th>
              <th className="px-2 py-2 text-left">Nom</th>
              <th className="px-2 py-2 text-center">Âge</th>
              <th className="px-2 py-2 text-left">Musique</th>
              <th className="px-2 py-2 text-left">Driver</th>
              <th className="px-2 py-2 text-right">Cote</th>
              <th className="px-2 py-2 text-right" title="% victoires plafonné">CX</th>
              <th className="px-2 py-2 text-right" title="Code 3 chiffres : taux victoires/places/expérience">RTX</th>
              <th className="px-2 py-2 text-right" title="Code 3 chiffres : gains annuels normalisés par âge">OR</th>
              <th className="px-2 py-2 text-right" title="Indice de confiance (forme + cote)">IDC</th>
              <th className="px-2 py-2 text-right" title="Coefficient de Forme & Potentiel">CFP</th>
              <th className="px-2 py-2 text-right" title="√(CFP / Cote) — indicateur value">RATIO</th>
              <th className="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {horses.map((h) => {
              const dim =
                (filter === "value" && !h.isTopValue) ||
                (filter === "potential" && !h.isTopPotential) ||
                (filter === "avoid" && !h.isToAvoid);
              return (
                <HorseRow
                  key={h.num}
                  h={h}
                  dim={dim}
                  onPick={onPick}
                  isPicked={picked.includes(h.num)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DuelComparator({ horses, picked, onClear }) {
  if (picked.length !== 2) return null;
  const a = horses.find((h) => h.num === picked[0]);
  const b = horses.find((h) => h.num === picked[1]);
  if (!a || !b) return null;

  const winner = (k) => {
    if (a[k] === b[k]) return null;
    if (k === "cote") return a.cote < b.cote ? a.num : b.num; // cote basse = favori
    return a[k] > b[k] ? a.num : b.num;
  };

  const Cell = ({ h, k, fmt = (v) => v }) => {
    const w = winner(k);
    const isWinner = w === h.num;
    return (
      <td className={`px-3 py-2 text-center font-mono ${isWinner ? "text-emerald-300 font-bold" : "text-white/70"}`}>
        {fmt(h[k]) ?? "—"}
      </td>
    );
  };

  return (
    <div className="mb-6 rounded-xl border-2 border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-900/40 to-purple-900/40 backdrop-blur p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-white">
          <Swords className="h-5 w-5 text-fuchsia-300" />
          <span className="font-black text-base">DUEL — N°{a.num} vs N°{b.num}</span>
        </div>
        <Button onClick={onClear} size="sm" variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-white/60 border-b border-white/20">
              <th className="px-3 py-1 text-left">Indicateur</th>
              <th className="px-3 py-1 text-center">N°{a.num} {a.nom}</th>
              <th className="px-3 py-1 text-center">N°{b.num} {b.nom}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            <tr><td className="px-3 py-2 text-white/70">Cote PMU</td><Cell h={a} k="cote" fmt={(v) => v?.toFixed?.(1) ?? "—"} /><Cell h={b} k="cote" fmt={(v) => v?.toFixed?.(1) ?? "—"} /></tr>
            <tr><td className="px-3 py-2 text-white/70">Forme (5 dern.)</td><Cell h={a} k="formScore" /><Cell h={b} k="formScore" /></tr>
            <tr><td className="px-3 py-2 text-white/70">CX (% victoires)</td><Cell h={a} k="cx" /><Cell h={b} k="cx" /></tr>
            <tr><td className="px-3 py-2 text-white/70">IDC</td><Cell h={a} k="idc" /><Cell h={b} k="idc" /></tr>
            <tr><td className="px-3 py-2 text-white/70">CFP</td><Cell h={a} k="cfp" fmt={(v) => v?.toLocaleString?.("fr-FR")} /><Cell h={b} k="cfp" fmt={(v) => v?.toLocaleString?.("fr-FR")} /></tr>
            <tr className="bg-amber-500/10"><td className="px-3 py-2 text-white font-bold">RATIO Value</td><Cell h={a} k="ratio" /><Cell h={b} k="ratio" /></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TurfxZonesPanel({ scraperCtx }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState([]); // numéros sélectionnés pour duel

  const date = scraperCtx?.date;
  const reunion = scraperCtx?.reunion;
  const course = scraperCtx?.course;

  // Extrait les nombres : "R1" → 1, "C12" → 12
  const reunionNum = useMemo(() => {
    if (!reunion) return null;
    if (typeof reunion === "number") return reunion;
    const m = String(reunion).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }, [reunion]);
  const courseNum = useMemo(() => {
    if (!course) return null;
    if (typeof course === "number") return course;
    const m = String(course).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }, [course]);

  // Convertit DDMMYYYY → YYYY-MM-DD si nécessaire
  const isoDate = useMemo(() => {
    if (!date) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    if (/^\d{8}$/.test(date)) return `${date.slice(4, 8)}-${date.slice(2, 4)}-${date.slice(0, 2)}`;
    return date;
  }, [date]);

  const load = async () => {
    if (!isoDate || !reunionNum || !courseNum) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API}/turfx-zones/${isoDate}/R${reunionNum}/C${courseNum}`);
      setData(data);
      setPicked([]);
    } catch (err) {
      // FastAPI 422 retourne un array d'objets {type,loc,msg,input,url} → stringify
      let msg = err?.response?.data?.detail;
      if (Array.isArray(msg)) {
        msg = msg.map((e) => e.msg || JSON.stringify(e)).join(" · ");
      } else if (msg && typeof msg === "object") {
        msg = msg.msg || JSON.stringify(msg);
      }
      setError(msg || err?.message || "Erreur chargement");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoDate, reunionNum, courseNum]);

  const handlePick = (h) => {
    setPicked((prev) => {
      if (prev.includes(h.num)) return prev.filter((n) => n !== h.num);
      if (prev.length >= 2) return [prev[1], h.num];
      return [...prev, h.num];
    });
  };

  if (!isoDate || !reunionNum || !courseNum) {
    return (
      <div className="rounded-xl bg-slate-900/60 border-2 border-white/10 p-8 text-center">
        <Diamond className="h-12 w-12 mx-auto text-fuchsia-400 mb-3" />
        <h3 className="text-lg font-bold text-white">Sélectionne une course pour analyser les zones</h3>
        <p className="text-sm text-white/60 mt-1">L'analyse VALUE va calculer CX, RTX, OR, IDC, CFP & RATIO pour chaque cheval.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl bg-slate-900/60 border-2 border-white/10 p-8 text-center">
        <RefreshCw className="h-8 w-8 mx-auto text-fuchsia-400 mb-3 animate-spin" />
        <p className="text-sm text-white/70">Calcul des indicateurs en cours…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-rose-900/40 border-2 border-rose-400 p-4 text-rose-100" data-testid="zones-error">
        <AlertTriangle className="inline h-4 w-4 mr-1" />
        Erreur : {error}
        <Button onClick={load} size="sm" variant="outline" className="ml-3 bg-white/10 border-white/30 text-white hover:bg-white/20">
          Réessayer
        </Button>
      </div>
    );
  }

  if (!data || data.stats?.total === 0) {
    return (
      <div className="rounded-xl bg-slate-900/60 border-2 border-white/10 p-8 text-center">
        <p className="text-sm text-white/60">Aucun partant trouvé pour cette course.</p>
      </div>
    );
  }

  const { zones, summary, stats } = data;

  return (
    <section className="space-y-4" data-testid="turfx-zones-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-fuchsia-400" />
          <h2 className="text-xl font-black bg-gradient-to-r from-fuchsia-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
            ZONES VALUE TURFEX
          </h2>
          <span className="text-xs text-white/50 ml-2">R{reunionNum} · C{courseNum} · {stats.total} partants</span>
        </div>
        <Button
          onClick={load}
          size="sm"
          variant="outline"
          className="bg-white/10 border-white/30 text-white hover:bg-white/20"
          data-testid="zones-refresh-btn"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {/* Hero stars (résumé automatique) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="zones-hero-summary">
        <HeroCard
          icon={Crown}
          label="🏆 TOP VALUE DU JOUR"
          horse={summary.topValue}
          accentClass="bg-gradient-to-br from-emerald-600 via-cyan-600 to-blue-700"
          ratioClass="text-yellow-200"
        />
        <HeroCard
          icon={Trophy}
          label="◆ POTENTIEL MAX (CFP)"
          horse={summary.topPotential}
          accentClass="bg-gradient-to-br from-amber-600 via-orange-600 to-rose-700"
        />
        <HeroCard
          icon={Skull}
          label="⚠ CHEVAL À ÉVITER"
          horse={summary.toAvoid}
          accentClass="bg-gradient-to-br from-rose-700 via-red-700 to-slate-800"
        />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-800/60 border border-white/10 rounded-lg p-2" data-testid="zones-filters">
        <Filter className="h-3.5 w-3.5 text-white/50 ml-1" />
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 ${
                active
                  ? "bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow-lg"
                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              }`}
              data-testid={`zones-filter-${f.key}`}
            >
              <Icon className="h-3 w-3" />
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Comparateur duel */}
      <DuelComparator horses={data.horses} picked={picked} onClear={() => setPicked([])} />

      {/* Zones */}
      <ZoneTable zoneKey="A" horses={zones.A} filter={filter} summary={summary} onPick={handlePick} picked={picked} />
      <ZoneTable zoneKey="B" horses={zones.B} filter={filter} summary={summary} onPick={handlePick} picked={picked} />
      <ZoneTable zoneKey="C" horses={zones.C} filter={filter} summary={summary} onPick={handlePick} picked={picked} />

      {/* Légende */}
      <div className="bg-slate-800/40 border border-white/10 rounded-lg p-3 text-xs text-white/70 space-y-1.5" data-testid="zones-legend">
        <div className="font-bold text-white/90 flex items-center gap-1"><Target className="h-3 w-3" /> Comprendre les indicateurs</div>
        <div><b className="text-cyan-300">CX</b> : % de victoires plafonné. <b className="text-cyan-300">RTX</b> : code expérience (taux vict / places / nb courses).</div>
        <div className="bg-slate-900/40 rounded px-2 py-1.5 border-l-2 border-amber-400">
          <b className="text-amber-300">OR</b> = <span className="font-mono">⌊min(999, max(0, top3×400 + gains_an/2000 + forme×2 − disq_5×200 + win_3×50 + def_win×30))⌋</span>
          <div className="text-[10px] text-white/50 mt-0.5">
            Composite : régularité (podiums), gains annuels (€), forme 5 dernières courses · pénalité <span className="text-rose-300">−200 par disq dans les 5 dernières</span> · bonus <span className="text-emerald-300">+50 par victoire dans les 3 dernières</span> · signal pro <span className="text-cyan-300">+30 si déferré + dernière course gagnée</span>.
          </div>
        </div>
        <div><b className="text-cyan-300">IDC</b> : Indice de confiance (60% forme + 40% cote). <b className="text-cyan-300">CFP</b> : Coefficient Forme & Potentiel global.</div>
        <div><b className="text-amber-300">RATIO</b> = √(CFP / Cote) — indicateur de value. <span className="text-emerald-400">&gt;20 très value</span>, <span className="text-cyan-300">10-20 value</span>, <span className="text-amber-300">5-10 correct</span>, <span className="text-rose-300">&lt;5 surcoté</span>.</div>
      </div>
    </section>
  );
}

