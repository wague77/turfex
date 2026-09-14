"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import Link from "next/link";
import axios from "axios";
import { ClasseTable } from "@/components/ClasseTable";
import { ClassementTable } from "@/components/ClassementTable";
import { PmuScraper } from "@/components/PmuScraper";
import { ArriveeBanner } from "@/components/ArriveeBanner";
import { ArriveesPanel } from "@/components/ArriveesPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { BuyAccessButton, RenewBanner } from "@/components/BuyAccessButton";
import { DetailPartants } from "@/components/DetailPartants";
import { AnalyseProTab } from "@/components/AnalyseProTab";
import { VisualisationsTab } from "@/components/VisualisationsTab";
import { StrategieTab } from "@/components/StrategieTab";
import { CarresMagiquesPanel } from "@/components/CarresMagiquesPanel";
import { IntelligencePanel } from "@/components/IntelligencePanel";
import FerranPanel from "@/components/FerranPanel";
import TurfxZonesPanel from "@/components/TurfxZonesPanel";
import TurfAstroPanel from "@/components/turf_astro/TurfAstroPanel";
import AstroErrorBoundary from "@/components/turf_astro/AstroErrorBoundary";
import FortunePanel from "@/components/fortune/FortunePanel";
import { CourseAnalysis } from "@/components/CourseAnalysis";
import { PronosticRapide } from "@/components/PronosticRapide";
import { CoupsPreparesTab } from "@/components/CoupsPreparesTab";
import { StatsDriverPanel } from "@/components/StatsDriverPanel";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SideNav } from "@/components/SideNav";
import { History, Download, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { exportCsv } from "@/lib/csv";
import { sendLocalNotification } from "@/lib/pwa";
import { useSettings } from "@/contexts/SettingsContext";
import { useCodeWatchdog } from "@/hooks/useCodeWatchdog";
import { APP_NAME, APP_TAGLINE } from "@/lib/branding";
// Logo importé via public/ pour Next.js
const LOGO_SRC = "/logo.svg";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;
const NB_CLASSES = 20;
const emptyCourse = () => ({ allocation: 0, valeur: 0, place: 0, partants: 0 });
const emptyClasse = () => [emptyCourse(), emptyCourse(), emptyCourse()];

const Index = () => {
  const { settings } = useSettings();
  const scraperRef = useRef(null);
  const [classes, setClasses] = useState(() =>
    Array.from({ length: NB_CLASSES }, emptyClasse)
  );
  const [cafs, setCafs] = useState(() => Array(NB_CLASSES).fill(0));
  const [arrivee, setArrivee] = useState([]);
  const [courseInfo, setCourseInfo] = useState("");
  const [horses, setHorses] = useState({});
  const [meta, setMeta] = useState(null);
  const [currentCourse, setCurrentCourse] = useState({});
  const [scraperCtx, setScraperCtx] = useState({ date: null, reunion: null, course: null });
  const [saving, setSaving] = useState(false);
  const [weather, setWeather] = useState(null);

  // Charge la météo quand hippodrome + date changent
  useEffect(() => {
    const hippo = currentCourse?.hippodrome;
    const d = scraperCtx?.date;
    if (!hippo || !d) { setWeather(null); return; }
    let cancelled = false;
    axios.get(`${API}/weather`, { params: { hippodrome: hippo, date: d } })
      .then((resp) => { if (!cancelled) setWeather(resp.data?.error ? null : resp.data); })
      .catch(() => { if (!cancelled) setWeather(null); });
    return () => { cancelled = true; };
  }, [currentCourse?.hippodrome, scraperCtx?.date]);

  // Récupère les infos d'auth utilisateur (depuis sessionStorage)
  const userInfo = (() => {
    try {
      const data = JSON.parse(sessionStorage.getItem("wague-pmu-auth") || "{}");
      if (!data?.code) return null;
      return {
        code: data.code,
        expiresAt: data.expiresAt || null,
        label: data.label || null,
      };
    } catch (_) {
      return null;
    }
  })();

  const userExpiry = userInfo?.expiresAt || null;

  // Watchdog : vérifie toutes les 60s que le code utilisateur est toujours actif côté serveur.
  // Si l'admin désactive ou supprime le code → déconnexion automatique.
  useCodeWatchdog(userInfo?.code);

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.removeItem("wague-pmu-auth");
    } catch (_) {}
    toast.success("Déconnexion réussie");
    // Petit délai pour que le toast s'affiche, puis full reload pour repasser par le PasswordGate
    setTimeout(() => {
      window.location.href = "/";
    }, 600);
  }, []);

  const handleScraped = useCallback((newClasses, newArrivee, info, newHorses, newMeta, courseMeta) => {
    setClasses(newClasses);
    setArrivee(newArrivee || []);
    setCourseInfo(info || "");
    setHorses(newHorses || {});
    setMeta(newMeta || null);
    setCurrentCourse(courseMeta || {});
  }, []);

  const handleChange = useCallback((classeIdx, courseIdx, field, value) => {
    setClasses((prev) => {
      const next = prev.map((c) => c.map((cc) => ({ ...cc })));
      next[classeIdx][courseIdx][field] = value;
      return next;
    });
  }, []);

  const handleCaf = useCallback((classeIdx, caf) => {
    setCafs((prev) => {
      if (prev[classeIdx] === caf) return prev;
      const next = [...prev];
      next[classeIdx] = caf;
      return next;
    });
  }, []);

  const rows = cafs.map((caf, i) => ({ classe: i + 1, caf }));

  // Top 7 CAF set
  const top7 = [...rows]
    .filter((r) => r.caf > 0)
    .sort((a, b) => b.caf - a.caf)
    .slice(0, 7)
    .map((r) => r.classe);
  const top5 = top7.slice(0, 5);

  const handleSave = async () => {
    if (!meta) {
      toast.error("Aucun pronostic à sauvegarder. Lance d'abord le scraping.");
      return;
    }
    setSaving(true);
    try {
      const classement = [...rows]
        .filter((r) => r.caf > 0)
        .sort((a, b) => b.caf - a.caf)
        .map((r) => r.classe);
      const tierceHits = arrivee.slice(0, 3).filter((n) => classement.slice(0, 3).includes(n)).length;
      const top7Hits = arrivee.slice(0, 7).filter((n) => classement.slice(0, 7).includes(n)).length;
      await axios.post(`${API}/pronostics`, {
        ...meta, courseInfo, cafs, classement, arrivee, tierceHits, top7Hits,
      });
      toast.success("Pronostic sauvegardé");
    } catch (_) {
      toast.error("Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!meta) {
      toast.error("Rien à exporter");
      return;
    }
    const data = rows
      .map((r) => ({
        classe: r.classe,
        caf: r.caf,
        cheval: horses[r.classe]?.nom || "",
        driver: horses[r.classe]?.driver || "",
        cote: horses[r.classe]?.cote ?? "",
        musique: horses[r.classe]?.musique || "",
      }))
      .filter((x) => x.caf > 0)
      .sort((a, b) => b.caf - a.caf)
      .map((x, i) => ({ rang: i + 1, ...x, arrivee: arrivee[i] || "" }));
    exportCsv(`wague_${meta.date}_${meta.reunion}${meta.course}.csv`, data);
  };

  // État onglet courant (contrôlé — utilisé par <SideNav />)
  const [currentTab, setCurrentTab] = useState("rapide");

  // Keyboard: Enter dans inputs déclenche déjà le focus suivant. Ctrl+S save.
  // (géré naturellement)

  return (
    <main className="min-h-screen bg-background py-6 px-4">
      <h1 className="sr-only">{APP_NAME} — {APP_TAGLINE}</h1>
      <header className="mb-6 text-center">
        <div className="inline-flex items-center gap-5 bg-black px-10 py-4 border-4 border-black rounded shadow-2xl relative">
          <img src={LOGO_SRC} alt={`${APP_NAME} logo`} width={72} height={72} className="h-18 w-18 object-contain drop-shadow-lg" />
          <div className="flex flex-col items-start leading-none">
            <span
              className="text-5xl md:text-6xl font-black italic tracking-tight bg-gradient-to-r from-pink-500 via-yellow-400 via-green-400 via-cyan-400 to-violet-500 bg-clip-text text-transparent"
              style={{ fontFamily: "Impact, 'Arial Black', sans-serif", letterSpacing: "0.02em" }}
            >
              {APP_NAME}
            </span>
            <span className="text-[11px] md:text-xs font-bold tracking-[0.4em] text-yellow-300 mt-1 uppercase">
              {APP_TAGLINE}
            </span>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_auto] gap-6 max-w-[1700px] mx-auto">
        <div className="space-y-4">
          <RenewBanner expiresAt={userExpiry} />
          <PmuScraper
            ref={scraperRef}
            onScraped={handleScraped}
            onContextChange={setScraperCtx}
            settingsBtn={
              <div className="flex items-center gap-2">
                <SettingsPanel />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => window.open("/odds-detective", "_blank", "noopener,noreferrer")}
                  className="bg-gradient-to-r from-emerald-900 to-black border-2 border-[#00FF66] hover:opacity-90 text-[#00FF66] hover:text-[#00FF66]"
                  title="Odds Détective — analyses & méthodes"
                  data-testid="odds-detective-launch-btn"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            }
            historyBtn={
              <Link href="/historique">
                <Button variant="outline" size="icon" className="bg-white border-2 border-black hover:bg-yellow-200" title="Historique">
                  <History className="h-4 w-4" />
                </Button>
              </Link>
            }
            exportBtn={
              <>
                <BuyAccessButton variant="icon" />
                <Button
                  onClick={handleSave}
                  disabled={saving || !meta}
                  variant="outline"
                  size="icon"
                  className="bg-white border-2 border-black hover:bg-green-200"
                  title="Sauvegarder ce pronostic"
                >
                  <Save className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleExport}
                  variant="outline"
                  size="icon"
                  className="bg-white border-2 border-black hover:bg-blue-200"
                  title="Exporter en CSV"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </>
            }
          />
          <ArriveeBanner arrivee={arrivee} cafs={cafs} courseInfo={courseInfo} />
          <CourseAnalysis horses={horses} cafs={cafs} currentCourse={currentCourse} scraperCtx={scraperCtx} />
          <StatsDriverPanel horses={horses} />

          <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex flex-col gap-4 lg:shrink-0">
                <SideNav
                  value={currentTab}
                  onValueChange={setCurrentTab}
                  horsesCount={Object.keys(horses).length}
                  userInfo={userInfo}
                  onLogout={handleLogout}
                />
                <div className="hidden lg:block">
                  <ClassementTable rows={rows} arrivee={arrivee} horses={horses} />
                </div>
              </div>
              <div className="flex-1 min-w-0">

            <TabsContent value="rapide" className="mt-0">
              <PronosticRapide
                horses={horses}
                cafs={cafs}
                currentCourse={currentCourse}
                arrivee={arrivee}
                courseInfo={courseInfo}
                weather={weather}
              />
            </TabsContent>

            <TabsContent value="coups" className="mt-0">
              <CoupsPreparesTab
                horses={horses}
                cafs={cafs}
                currentCourse={currentCourse}
                arrivee={arrivee}
              />
            </TabsContent>

            <TabsContent value="caf" className="space-y-4 mt-0">
              {classes.map((courses, i) => {
                const classeNum = i + 1;
                const isTop5 = settings.highlightTop5 && top5.includes(classeNum);
                const isWinner = arrivee.length > 0 && arrivee[0] === classeNum;
                return (
                  <ClasseTable
                    key={i}
                    index={classeNum}
                    courses={courses}
                    onChange={(ci, f, v) => handleChange(i, ci, f, v)}
                    onCaf={(c) => handleCaf(i, c)}
                    horseInfo={horses[classeNum]}
                    isTop5={isTop5}
                    isWinner={isWinner}
                  />
                );
              })}
            </TabsContent>

            <TabsContent value="detail" className="mt-0">
              <DetailPartants horses={horses} arrivee={arrivee} currentCourse={currentCourse} weather={weather} />
            </TabsContent>

            <TabsContent value="analyse" className="mt-0">
              <AnalyseProTab horses={horses} cafs={cafs} currentCourse={currentCourse} arrivee={arrivee} />
            </TabsContent>

            <TabsContent value="visu" className="mt-0">
              <VisualisationsTab horses={horses} cafs={cafs} currentCourse={currentCourse} />
            </TabsContent>

            <TabsContent value="strategie" className="mt-0">
              <StrategieTab horses={horses} cafs={cafs} currentCourse={currentCourse} arrivee={arrivee} />
            </TabsContent>

            <TabsContent value="carres" className="mt-0">
              <CarresMagiquesPanel horses={horses} cafs={cafs} currentCourse={currentCourse} arrivee={arrivee} />
            </TabsContent>

            <TabsContent value="intelligence" className="mt-0">
              <IntelligencePanel />
            </TabsContent>

            <TabsContent value="ferran" className="mt-0">
              <FerranPanel />
            </TabsContent>

            <TabsContent value="zones" className="mt-0">
              <TurfxZonesPanel scraperCtx={scraperCtx} />
            </TabsContent>

            <TabsContent value="astro" className="mt-0">
              <AstroErrorBoundary>
                <TurfAstroPanel />
              </AstroErrorBoundary>
            </TabsContent>

            <TabsContent value="fortune" className="mt-0">
              <AstroErrorBoundary>
                <FortunePanel />
              </AstroErrorBoundary>
            </TabsContent>
              </div>
            </div>
          </Tabs>
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <div className="lg:hidden">
            <ClassementTable rows={rows} arrivee={arrivee} horses={horses} />
          </div>
          <ArriveesPanel
            date={scraperCtx.date}
            reunion={scraperCtx.reunion}
            onLoadCourse={(num) => scraperRef.current?.loadCourse(num)}
          />
        </aside>
      </div>
    </main>
  );
};

export default Index;

