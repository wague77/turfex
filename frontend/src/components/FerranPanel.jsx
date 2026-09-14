"use client";

/**
 * FerranPanel — mini-app PMU Turf Analytics intégrée comme onglet TURFEX.
 *
 * 4 sous-vues (sélection via tabs internes) :
 *  - Programme : liste des réunions/courses du jour, sélection → drawer détail
 *  - Méthode Ferran : analyse par élimination + couplés/tiercés probables
 *  - Statistiques : KPIs jour (top drivers/entraineurs, distribs)
 *  - Résultats : arrivées définitives
 *
 * Backend : endpoints /api/ferran/* (auto-contenus, ne touchent pas TURFEX existant).
 *
 * Design tokens (préservés depuis l'app source) :
 *  - Fond #0A0A0A · accent #007AFF · sub #121212
 *  - font-display = Barlow Condensed (déjà chargé via index.css TURFEX si dispo, sinon system)
 *  - font-mono-data = JetBrains Mono / monospace
 */
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  House,
  ChartLineUp,
  Trophy,
  Brain,
  CalendarBlank,
  MapPin,
  Clock,
  Horse,
  CaretRight,
  Lightning,
  ThermometerSimple,
  Crown,
  ArrowRight,
  ChartBar,
  UsersThree,
} from "@phosphor-icons/react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;
const ferranClient = axios.create({ baseURL: API, timeout: 30000 });

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatTime = (ts) => {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

const fetchProgramme = (date) => ferranClient.get(`/ferran/programme/${date}`).then((r) => r.data);
const fetchParticipants = (date, r, c) => ferranClient.get(`/ferran/programme/${date}/R${r}/C${c}/participants`).then((res) => res.data);
const fetchFerran = (date, r, c) => ferranClient.get(`/ferran/analyze/${date}/R${r}/C${c}`).then((res) => res.data);
const fetchStats = (date) => ferranClient.get(`/ferran/stats/${date}`).then((r) => r.data);

const SUB_NAV = [
  { value: "programme", label: "Programme", Icon: House },
  { value: "ferran", label: "Méthode Ferran", Icon: Brain },
  { value: "stats", label: "Statistiques", Icon: ChartLineUp },
  { value: "results", label: "Résultats", Icon: Trophy },
];

export default function FerranPanel() {
  const [view, setView] = useState("programme");
  const [date, setDate] = useState(todayISO());
  const [refreshKey, setRefreshKey] = useState(0);
  const [tick, setTick] = useState(60);

  // Auto-refresh 60s
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => {
        if (t <= 1) {
          setRefreshKey((k) => k + 1);
          return 60;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ferran-app bg-[#0A0A0A] text-white relative min-h-[800px] -mx-4 md:-mx-0" data-testid="ferran-panel">
      <style>{`
        .ferran-app .font-display { font-family: 'Barlow Condensed', 'Inter', system-ui, sans-serif; letter-spacing: -0.01em; }
        .ferran-app .font-mono-data { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; font-variant-numeric: tabular-nums; }
        @keyframes ferran-live-pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        .ferran-app .ferran-live-dot { animation: ferran-live-pulse 1.5s ease-in-out infinite; }
        @keyframes ferran-refresh-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        .ferran-app .ferran-refresh-bar { transform-origin: left; animation: ferran-refresh-fill 60s linear infinite; }
      `}</style>

      <div className="border-b border-white/10 bg-black/80 backdrop-blur-sm">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-display font-black text-2xl tracking-tighter uppercase text-white">
              TURF<span className="text-[#007AFF]">.OPS</span>
            </span>
            <span className="font-mono-data text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              pmu analytics · ferran
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 border border-emerald-500/30 bg-emerald-500/5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ferran-live-dot" />
              <span className="font-mono-data text-[10px] uppercase tracking-wider text-emerald-400">LIVE</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 border border-white/10 px-3 py-1.5 bg-white/[0.02]">
              <CalendarBlank size={14} className="text-zinc-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-sm font-mono-data text-white outline-none [color-scheme:dark]"
                data-testid="ferran-date-picker"
              />
            </div>
            <span className="font-mono-data text-xs text-zinc-500 tabular-nums" data-testid="ferran-refresh-countdown">
              REFRESH {String(tick).padStart(2, "0")}s
            </span>
          </div>
        </div>

        <nav className="px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
          {SUB_NAV.map(({ value: v, label, Icon }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors duration-150 whitespace-nowrap ${
                view === v ? "border-[#007AFF] text-white" : "border-transparent text-zinc-500 hover:text-white"
              }`}
              data-testid={`ferran-nav-${v}`}
            >
              <Icon size={16} weight="bold" />
              <span className="font-display font-bold uppercase tracking-wider text-sm">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <main className="px-4 md:px-6 py-6">
        {view === "programme" && <ProgrammeView date={date} refreshKey={refreshKey} />}
        {view === "ferran" && <FerranView date={date} refreshKey={refreshKey} />}
        {view === "stats" && <StatsView date={date} refreshKey={refreshKey} />}
        {view === "results" && <ResultsView date={date} refreshKey={refreshKey} />}
      </main>

      <footer className="border-t border-white/5 mt-12 px-6 py-4 text-xs text-zinc-600 font-mono-data uppercase tracking-wider flex justify-between">
        <span>turf.ops · données pmu.fr</span>
        <span>méthode ferran v1.0</span>
      </footer>
    </div>
  );
}

// ============ PROGRAMME VIEW ============
function ProgrammeView({ date, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr(null);
    fetchProgramme(date)
      .then((d) => !cancel && setData(d))
      .catch((e) => !cancel && setErr(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [date, refreshKey]);

  if (loading) return <div className="font-mono-data text-zinc-500 text-sm" data-testid="ferran-programme-loading">LOADING PROGRAMME...</div>;
  if (err) return <div className="border border-red-500/40 bg-red-500/5 p-4 text-red-300 font-mono-data text-sm" data-testid="ferran-programme-error">{String(err)}</div>;

  const reunions = data?.reunions || [];

  return (
    <div className="space-y-6" data-testid="ferran-programme-page">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter">Programme</h1>
        <p className="font-mono-data text-sm text-zinc-500 uppercase tracking-wider mt-1">
          {new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · {reunions.length} réunions
        </p>
      </div>

      {reunions.length === 0 && (
        <div className="border border-white/10 p-8 text-center text-zinc-400">Aucune réunion pour cette date.</div>
      )}

      <div className="grid gap-4">
        {reunions.map((r) => (
          <div key={r.numReunion} className="border border-white/10 bg-[#121212]" data-testid={`ferran-reunion-${r.numReunion}`}>
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="font-display font-black text-2xl text-[#007AFF] tabular-nums">R{r.numReunion}</span>
                <div>
                  <div className="font-display font-bold uppercase tracking-tight text-lg">{r.hippodrome}</div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono-data uppercase tracking-wider">
                    <MapPin size={11} /> {r.pays} · {r.nature}
                    {r.specialites?.[0] && <> · {r.specialites[0]}</>}
                  </div>
                </div>
              </div>
              {r.meteo && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono-data">
                  <ThermometerSimple size={12} />
                  {r.meteo.temperature}°C · {r.meteo.nebulositeLibelleCourt || r.meteo.nebulosite}
                </div>
              )}
            </div>
            <div className="divide-y divide-white/5">
              {r.courses.map((c) => (
                <button
                  key={c.numCourse}
                  onClick={() => setSelected({ r: r.numReunion, c: c.numCourse, course: c, hippo: r.hippodrome })}
                  className="w-full text-left px-5 py-3 flex items-center gap-4 hover:bg-white/[0.03] transition-colors duration-150 group"
                  data-testid={`ferran-course-btn-R${r.numReunion}C${c.numCourse}`}
                >
                  <span className="font-mono-data text-xs text-zinc-500 w-8 tabular-nums">C{c.numCourse}</span>
                  <span className="font-mono-data text-sm text-white tabular-nums w-14">
                    <Clock size={11} className="inline mr-1 text-zinc-500" />{formatTime(c.heureDepart)}
                  </span>
                  <span className="flex-1 truncate font-display font-semibold text-base uppercase tracking-tight">{c.libelle}</span>
                  <span className="hidden md:inline-flex items-center gap-1 text-xs text-zinc-500 font-mono-data uppercase">
                    <Horse size={11} /> {c.discipline?.replace("_", " ")}
                  </span>
                  <span className="font-mono-data text-xs text-zinc-400 tabular-nums w-20 text-right">
                    {c.distance}{c.distanceUnit === "METRE" ? "m" : ""}
                  </span>
                  {c.arriveeDefinitive && (
                    <span className="px-2 py-0.5 border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-mono-data text-[10px] uppercase tracking-wider">Arrivée</span>
                  )}
                  {c.departImminent && (
                    <span className="px-2 py-0.5 border border-amber-500/40 bg-amber-500/10 text-amber-400 font-mono-data text-[10px] uppercase tracking-wider flex items-center gap-1">
                      <Lightning size={10} /> Imminent
                    </span>
                  )}
                  <CaretRight size={14} className="text-zinc-600 group-hover:text-[#007AFF]" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <RaceDrawer
          date={date}
          r={selected.r}
          c={selected.c}
          course={selected.course}
          hippo={selected.hippo}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ============ RACE DRAWER (Sheet shadcn) ============
function RaceDrawer({ date, r, c, course, hippo, onClose }) {
  const [parts, setParts] = useState(null);
  const [ferran, setFerran] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([
      fetchParticipants(date, r, c).catch(() => ({ participants: [] })),
      fetchFerran(date, r, c).catch(() => null),
    ]).then(([p, f]) => {
      if (cancel) return;
      setParts(p);
      setFerran(f);
      setLoading(false);
    });
    return () => { cancel = true; };
  }, [date, r, c]);

  const arrivee = course?.ordreArrivee?.[0] || null;
  const isFinished = course?.arriveeDefinitive;
  const ferranStatus = (numPmu) => {
    if (!ferran) return null;
    if (ferran.eliminated?.includes(numPmu)) return "elim";
    if (ferran.kept?.includes(numPmu)) return "kept";
    return null;
  };

  return (
    <Sheet open={true} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl bg-[#0A0A0A] border-l border-white/10 text-white p-0 overflow-y-auto"
        data-testid="ferran-race-drawer"
      >
        <SheetHeader className="px-6 py-5 border-b border-white/10 sticky top-0 bg-black/90 backdrop-blur-2xl z-10">
          <SheetTitle asChild>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-display font-black text-3xl text-[#007AFF] tabular-nums">R{r}C{c}</span>
                <span className="font-mono-data text-xs text-zinc-500 uppercase tracking-widest">
                  {hippo} · {formatTime(course.heureDepart)}
                </span>
              </div>
              <h2 className="font-display font-black text-xl uppercase tracking-tight text-left">{course.libelle}</h2>
              <p className="font-mono-data text-xs text-zinc-500 uppercase mt-1">
                {course.discipline?.replace("_", " ")} · {course.distance}{course.distanceUnit === "METRE" ? "m" : ""}
                {course.montantPrix ? ` · ${course.montantPrix.toLocaleString("fr-FR")} €` : ""}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>

        {isFinished && arrivee && (
          <div className="mx-6 mt-4 border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <div className="font-mono-data text-[10px] uppercase tracking-widest text-emerald-400 mb-1">Arrivée définitive</div>
            <div className="font-display font-black text-2xl text-white tabular-nums tracking-tight">
              {arrivee.join(" · ")}
            </div>
          </div>
        )}

        <Tabs defaultValue="partants" className="px-6 py-4">
          <TabsList className="bg-transparent border border-white/10 rounded-none w-full justify-start p-0 h-auto">
            <TabsTrigger
              value="partants"
              className="rounded-none border-r border-white/10 data-[state=active]:bg-[#007AFF] data-[state=active]:text-white font-display uppercase tracking-wider px-4 py-2"
              data-testid="ferran-tab-partants"
            >Partants</TabsTrigger>
            <TabsTrigger
              value="ferran"
              className="rounded-none data-[state=active]:bg-[#007AFF] data-[state=active]:text-white font-display uppercase tracking-wider px-4 py-2"
              data-testid="ferran-tab-ferran"
            ><Brain size={14} className="mr-1.5" /> Ferran</TabsTrigger>
          </TabsList>

          <TabsContent value="partants" className="mt-4">
            {loading ? (
              <div className="font-mono-data text-zinc-500 text-sm py-8">CHARGEMENT...</div>
            ) : (
              <div className="border border-white/10 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02]">
                      {["#", "Cheval", "Driver/Jockey", "Entraîneur", "Stats", "Cote", "Musique"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-mono-data text-[10px] uppercase tracking-widest text-zinc-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parts?.participants?.map((p) => {
                      const fs = ferranStatus(p.numPmu);
                      const isWinner = arrivee?.[0] === p.numPmu;
                      return (
                        <tr
                          key={p.numPmu}
                          className={`border-b border-white/5 hover:bg-white/[0.03] ${fs === "elim" ? "opacity-40" : ""}`}
                          data-testid={`ferran-participant-${p.numPmu}`}
                        >
                          <td className="px-3 py-2.5 font-mono-data tabular-nums font-bold w-10">
                            <div className="flex items-center gap-1">
                              {isWinner && <Crown size={12} weight="fill" className="text-amber-400" />}
                              {p.numPmu}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-display font-semibold uppercase tracking-tight">
                              {p.nom}
                              {fs === "kept" && (
                                <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-mono-data">KEEP</span>
                              )}
                              {fs === "elim" && (
                                <span className="ml-2 px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-red-500/15 border border-red-500/40 text-red-400 font-mono-data">ELIM</span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-mono-data">
                              {p.sexe} · {p.age}a {p.handicapDistance ? `· ${p.handicapDistance}m` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-zinc-300">{p.driver || "—"}</td>
                          <td className="px-3 py-2.5 text-zinc-400 text-xs">{p.entraineur || "—"}</td>
                          <td className="px-3 py-2.5 font-mono-data text-xs text-zinc-300 tabular-nums">
                            {p.nombreCourses ?? 0}c · {p.nombreVictoires ?? 0}v · {p.nombrePlaces ?? 0}p
                          </td>
                          <td className="px-3 py-2.5 font-mono-data text-base font-bold tabular-nums text-amber-300">
                            {p.rapportDirect ? p.rapportDirect.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono-data text-xs text-zinc-500 max-w-[120px] truncate">
                            {p.musique || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ferran" className="mt-4 space-y-4">
            {!ferran ? (
              <div className="font-mono-data text-zinc-500 text-sm py-8">Analyse Ferran indisponible.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Partants" value={ferran.totalPartants} />
                  <Stat label="Pairs" value={ferran.parity?.pair?.length} />
                  <Stat label="Impairs" value={ferran.parity?.impair?.length} />
                  <Stat label="Dominante" value={ferran.parity?.dominant?.toUpperCase()} />
                </div>

                <Section title="★ Top Couplés probables">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ferran.topCouples?.slice(0, 6).map((cp, i) => (
                      <div key={i} className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2" data-testid={`ferran-top-couple-${i}`}>
                        <div className="font-display font-black text-xl text-emerald-300 tabular-nums">{cp.couple.join(" - ")}</div>
                        <div className="font-mono-data text-[10px] text-zinc-500 uppercase tracking-wider">score {cp.score}</div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="★★ Top Tiercés probables">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ferran.topTierces?.slice(0, 4).map((t, i) => (
                      <div key={i} className="border border-[#007AFF]/40 bg-[#007AFF]/10 px-3 py-2" data-testid={`ferran-top-tierce-${i}`}>
                        <div className="font-display font-black text-xl text-[#7CB7FF] tabular-nums">{t.tierce.join(" - ")}</div>
                        <div className="font-mono-data text-[10px] text-zinc-500 uppercase tracking-wider">score {t.score}</div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Scoring par partant">
                  <div className="border border-white/10 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.02]">
                          {["#", "Cheval", "Cote", "Réussite", "Écart", "Score"].map((h) => (
                            <th key={h} className="text-left px-3 py-2 font-mono-data text-[10px] uppercase tracking-widest text-zinc-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ferran.scored?.map((s) => (
                          <tr key={s.numPmu} className={`border-b border-white/5 ${ferran.eliminated?.includes(s.numPmu) ? "opacity-40" : ""}`}>
                            <td className="px-3 py-1.5 font-mono-data tabular-nums">{s.numPmu}</td>
                            <td className="px-3 py-1.5 font-display font-semibold">{s.nom}</td>
                            <td className="px-3 py-1.5 font-mono-data tabular-nums text-amber-300">{s.odds ? s.odds.toFixed(1) : "—"}</td>
                            <td className="px-3 py-1.5 font-mono-data tabular-nums">{s.successRate}%</td>
                            <td className="px-3 py-1.5 font-mono-data tabular-nums">{s.ecartScore}</td>
                            <td className="px-3 py-1.5 font-mono-data tabular-nums font-bold text-emerald-300">{s.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ============ FERRAN VIEW (analyse + sélection course en split) ============
function FerranView({ date, refreshKey }) {
  const [programme, setProgramme] = useState(null);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingA, setLoadingA] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoadingP(true);
    fetchProgramme(date)
      .then((d) => {
        if (cancel) return;
        setProgramme(d);
        const all = (d.reunions || []).flatMap((r) =>
          r.courses.map((c) => ({ r: r.numReunion, c: c.numCourse, course: c, hippo: r.hippodrome }))
        );
        const next = all.find((x) => !x.course.arriveeDefinitive) || all[0];
        if (next) setSelected(next);
      })
      .finally(() => !cancel && setLoadingP(false));
    return () => { cancel = true; };
  }, [date, refreshKey]);

  useEffect(() => {
    if (!selected) return;
    let cancel = false;
    setLoadingA(true);
    fetchFerran(date, selected.r, selected.c)
      .then((d) => !cancel && setAnalysis(d))
      .catch(() => !cancel && setAnalysis(null))
      .finally(() => !cancel && setLoadingA(false));
    return () => { cancel = true; };
  }, [date, selected]);

  const reunions = programme?.reunions || [];

  return (
    <div className="space-y-6" data-testid="ferran-method-page">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter flex items-center gap-3">
          <Brain size={42} weight="fill" className="text-[#007AFF]" />
          Méthode Ferran
        </h1>
        <p className="font-mono-data text-sm text-zinc-500 uppercase tracking-wider mt-1 max-w-3xl">
          Pronostic par élimination · synthèse presse · écarts · chiffrage 1ère lettre · séries pairs/impairs · suite numérique
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-white/10 bg-[#121212] max-h-[80vh] overflow-y-auto">
          <div className="px-4 py-2 border-b border-white/10 font-display uppercase tracking-wider text-xs text-zinc-400">
            Sélectionner une course
          </div>
          {loadingP ? (
            <div className="px-4 py-8 font-mono-data text-zinc-500 text-xs">CHARGEMENT...</div>
          ) : (
            reunions.map((r) => (
              <div key={r.numReunion} className="border-b border-white/5">
                <div className="px-4 py-2 bg-white/[0.02] font-mono-data text-[11px] uppercase tracking-widest text-zinc-400">
                  R{r.numReunion} · {r.hippodrome}
                </div>
                {r.courses.map((c) => {
                  const active = selected?.r === r.numReunion && selected?.c === c.numCourse;
                  return (
                    <button
                      key={c.numCourse}
                      onClick={() => setSelected({ r: r.numReunion, c: c.numCourse, course: c, hippo: r.hippodrome })}
                      className={`w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-white/[0.03] ${
                        active ? "bg-[#007AFF]/10 border-l-2 border-[#007AFF]" : "border-l-2 border-transparent"
                      }`}
                      data-testid={`ferran-method-course-R${r.numReunion}C${c.numCourse}`}
                    >
                      <span className="font-mono-data text-xs text-zinc-500 tabular-nums w-12">
                        C{c.numCourse} {formatTime(c.heureDepart)}
                      </span>
                      <span className="flex-1 truncate text-sm">{c.libelle}</span>
                      {active && <ArrowRight size={12} className="text-[#007AFF]" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="lg:col-span-8 space-y-4">
          {!selected ? (
            <div className="border border-white/10 p-8 text-center text-zinc-500">
              Sélectionnez une course pour lancer l'analyse Ferran.
            </div>
          ) : loadingA ? (
            <div className="font-mono-data text-zinc-500 text-sm py-8">ANALYSE EN COURS...</div>
          ) : !analysis ? (
            <div className="border border-white/10 p-8 text-center text-zinc-500">
              Données indisponibles pour cette course.
            </div>
          ) : (
            <>
              <div className="border border-white/10 p-4">
                <div className="font-mono-data text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                  R{selected.r}C{selected.c} · {selected.hippo}
                </div>
                <h2 className="font-display font-black text-2xl uppercase tracking-tight">{selected.course.libelle}</h2>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tile label="Partants" value={analysis.totalPartants} />
                <Tile label="Conservés" value={analysis.kept?.length} accent="emerald" />
                <Tile label="Éliminés" value={analysis.eliminated?.length} accent="red" />
                <Tile label="Dominante" value={analysis.parity?.dominant?.toUpperCase()} />
              </div>

              <div>
                <h3 className="font-display uppercase tracking-wider text-sm text-zinc-300 mb-2">★ Top Couplés</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {analysis.topCouples?.slice(0, 8).map((cp, i) => (
                    <div key={i} className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5" data-testid={`ferran-method-couple-${i}`}>
                      <div className="font-display font-black text-2xl text-emerald-300 tabular-nums">{cp.couple.join(" - ")}</div>
                      <div className="font-mono-data text-[10px] text-zinc-500 uppercase tracking-wider">score {cp.score}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-display uppercase tracking-wider text-sm text-zinc-300 mb-2">★★ Top Tiercés</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {analysis.topTierces?.slice(0, 6).map((t, i) => (
                    <div key={i} className="border border-[#007AFF]/40 bg-[#007AFF]/10 px-3 py-2.5" data-testid={`ferran-method-tierce-${i}`}>
                      <div className="font-display font-black text-2xl text-[#7CB7FF] tabular-nums">{t.tierce.join(" - ")}</div>
                      <div className="font-mono-data text-[10px] text-zinc-500 uppercase tracking-wider">score {t.score}</div>
                    </div>
                  ))}
                </div>
              </div>

              {analysis.suites?.[0] && (
                <div>
                  <h3 className="font-display uppercase tracking-wider text-sm text-zinc-300 mb-2">
                    Suite de 2 nos · base [{analysis.suites[0].base.join(", ")}]
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {analysis.suites[0].candidates.map((n) => (
                      <span key={n} className="border border-white/15 bg-white/5 px-3 py-1.5 font-mono-data tabular-nums">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-display uppercase tracking-wider text-sm text-zinc-300 mb-2">Scoring multi-critères</h3>
                <div className="border border-white/10 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.02]">
                        {["#", "Cheval", "Driver", "Cote", "Réussite", "Écart", "Score", "Statut"].map((h) => (
                          <th key={h} className="text-left px-3 py-2 font-mono-data text-[10px] uppercase tracking-widest text-zinc-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.scored?.map((s) => {
                        const elim = analysis.eliminated?.includes(s.numPmu);
                        return (
                          <tr key={s.numPmu} className={`border-b border-white/5 hover:bg-white/[0.03] ${elim ? "opacity-40" : ""}`} data-testid={`ferran-scored-${s.numPmu}`}>
                            <td className="px-3 py-2 font-mono-data tabular-nums font-bold">{s.numPmu}</td>
                            <td className="px-3 py-2 font-display font-semibold uppercase tracking-tight">{s.nom}</td>
                            <td className="px-3 py-2 text-zinc-400 text-xs">{s.driver}</td>
                            <td className="px-3 py-2 font-mono-data tabular-nums text-amber-300">{s.odds ? s.odds.toFixed(1) : "—"}</td>
                            <td className="px-3 py-2 font-mono-data tabular-nums">{s.successRate}%</td>
                            <td className="px-3 py-2 font-mono-data tabular-nums">{s.ecartScore}</td>
                            <td className="px-3 py-2 font-mono-data tabular-nums font-bold text-emerald-300">{s.score}</td>
                            <td className="px-3 py-2">
                              {elim ? (
                                <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider bg-red-500/15 border border-red-500/40 text-red-400 font-mono-data">ÉLIMINÉ</span>
                              ) : (
                                <span className="px-2 py-0.5 text-[9px] uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-mono-data">CONSERVÉ</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ STATS VIEW ============
function StatsView({ date, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchStats(date)
      .then((d) => !cancel && setData(d))
      .catch(() => !cancel && setData(null))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [date, refreshKey]);

  if (loading) return <div className="font-mono-data text-zinc-500 text-sm" data-testid="ferran-stats-loading">COMPUTING STATS...</div>;
  if (!data) return <div className="text-zinc-500">Données indisponibles.</div>;

  return (
    <div className="space-y-6" data-testid="ferran-stats-page">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter">Statistiques</h1>
        <p className="font-mono-data text-sm text-zinc-500 uppercase tracking-wider mt-1">
          {new Date(date).toLocaleDateString("fr-FR")} · agrégat journalier
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Réunions" value={data.totalReunions} Icon={ChartBar} />
        <KPI label="Courses" value={data.totalCourses} Icon={Trophy} />
        <KPI label="Partants" value={data.totalPartants} Icon={Horse} />
        <KPI label="Favoris (cote<5)" value={data.favoritesUnder5} Icon={UsersThree} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Top Drivers / Jockeys"><Bars items={data.topDrivers} /></Panel>
        <Panel title="Top Entraîneurs"><Bars items={data.topTrainers} /></Panel>
        <Panel title="Distribution sexes"><KV obj={data.sexDistribution} /></Panel>
        <Panel title="Distribution âges"><KV obj={data.ageDistribution} /></Panel>
        <Panel title="Disciplines"><KV obj={data.disciplineDistribution} /></Panel>
      </div>
    </div>
  );
}

// ============ RESULTS VIEW ============
function ResultsView({ date, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchProgramme(date)
      .then((d) => !cancel && setData(d))
      .catch(() => !cancel && setData(null))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [date, refreshKey]);

  if (loading) return <div className="font-mono-data text-zinc-500" data-testid="ferran-results-loading">LOADING...</div>;

  const finishedCourses = (data?.reunions || []).flatMap((r) =>
    r.courses.filter((c) => c.arriveeDefinitive && c.ordreArrivee).map((c) => ({ ...c, hippo: r.hippodrome, numReunion: r.numReunion }))
  );

  return (
    <div className="space-y-6" data-testid="ferran-results-page">
      <div>
        <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter flex items-center gap-3">
          <Trophy size={42} weight="fill" className="text-amber-400" />
          Résultats
        </h1>
        <p className="font-mono-data text-sm text-zinc-500 uppercase tracking-wider mt-1">
          {finishedCourses.length} arrivées définitives
        </p>
      </div>

      {finishedCourses.length === 0 ? (
        <div className="border border-white/10 p-8 text-center text-zinc-500">
          Aucune arrivée définitive pour le moment.
        </div>
      ) : (
        <div className="grid gap-3">
          {finishedCourses.map((c) => (
            <div key={`${c.numReunion}-${c.numCourse}`} className="border border-white/10 bg-[#121212] p-4" data-testid={`ferran-result-R${c.numReunion}C${c.numCourse}`}>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="font-display font-black text-2xl text-[#007AFF] tabular-nums">R{c.numReunion}C{c.numCourse}</span>
                <span className="font-mono-data text-xs text-zinc-500 uppercase tracking-widest">{c.hippo} · {formatTime(c.heureDepart)}</span>
                <span className="font-display font-bold uppercase tracking-tight">{c.libelle}</span>
              </div>
              <div className="flex items-center gap-2">
                {c.ordreArrivee[0]?.map((num, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-center w-12 h-12 border-2 font-display font-black text-2xl tabular-nums ${
                      idx === 0 ? "border-amber-400 bg-amber-400/10 text-amber-300"
                      : idx === 1 ? "border-zinc-300 bg-zinc-300/10 text-zinc-100"
                      : idx === 2 ? "border-orange-700 bg-orange-700/10 text-orange-400"
                      : "border-white/15 bg-white/5 text-zinc-300"
                    }`}
                  >{num}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ HELPERS ============
function Stat({ label, value }) {
  return (
    <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="font-mono-data text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-display font-black text-xl tabular-nums">{value ?? "—"}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div>
      <div className="font-display font-bold uppercase tracking-wider text-sm mb-2 text-zinc-300">{title}</div>
      {children}
    </div>
  );
}
function Tile({ label, value, accent }) {
  const cls = accent === "emerald" ? "border-emerald-500/30 bg-emerald-500/5"
    : accent === "red" ? "border-red-500/30 bg-red-500/5"
    : "border-white/10 bg-white/[0.02]";
  return (
    <div className={`border ${cls} px-3 py-2`}>
      <div className="font-mono-data text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="font-display font-black text-2xl tabular-nums">{value ?? "—"}</div>
    </div>
  );
}
function KPI({ label, value, Icon }) {
  return (
    <div className="border border-white/10 bg-[#121212] px-4 py-3 flex items-center gap-3">
      <Icon size={28} className="text-[#007AFF]" />
      <div>
        <div className="font-mono-data text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
        <div className="font-display font-black text-3xl tabular-nums">{value ?? 0}</div>
      </div>
    </div>
  );
}
function Panel({ title, children }) {
  return (
    <div className="border border-white/10 bg-[#121212]">
      <div className="px-4 py-2 border-b border-white/10 font-display uppercase tracking-wider text-xs text-zinc-400">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function Bars({ items = [] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="text-zinc-500 text-sm">—</div>}
      {items.map((it) => (
        <div key={it.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div>
            <div className="text-sm truncate">{it.name}</div>
            <div className="h-1 bg-white/5 mt-1">
              <div className="h-full bg-[#007AFF]" style={{ width: `${(it.count / max) * 100}%` }} />
            </div>
          </div>
          <span className="font-mono-data text-sm tabular-nums text-zinc-300">{it.count}</span>
        </div>
      ))}
    </div>
  );
}
function KV({ obj = {} }) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="space-y-1.5">
      {entries.length === 0 && <div className="text-zinc-500 text-sm">—</div>}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between text-sm">
          <span className="text-zinc-300 uppercase tracking-wider text-xs font-mono-data">{k}</span>
          <span className="font-mono-data tabular-nums text-zinc-100">
            {v} <span className="text-zinc-500">({((v / total) * 100).toFixed(0)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

