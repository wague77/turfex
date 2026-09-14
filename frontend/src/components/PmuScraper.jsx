"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, Layers, Calendar } from "lucide-react";
import { useSettings } from "@/contexts/SettingsContext";
import { sendLocalNotification } from "@/lib/pwa";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const todayDDMMYYYY = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
};

const parseMusiquePlaces = (musique) => {
  if (!musique) return [];
  const cleaned = musique.replace(/\([^)]*\)/g, "");
  const places = [];
  const regex = /(\d+|[A-Za-z])[pamhscPAMHSC]/g;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const token = match[1];
    const n = parseInt(token, 10);
    places.push(isNaN(n) ? 0 : n);
    if (places.length === 3) break;
  }
  return places;
};

const buildClasses = (data) => {
  const participants = data.participants || [];
  const fallbackAllocation = data.course?.montantPrix || data.montantPrix || 0;
  const fallbackPartants = participants.length || data.nombreParticipants || 0;

  const newClasses = Array.from({ length: 20 }, () => [
    { allocation: 0, valeur: 1000, place: 0, partants: 0 },
    { allocation: 0, valeur: 1000, place: 0, partants: 0 },
    { allocation: 0, valeur: 1000, place: 0, partants: 0 },
  ]);
  const horses = {};

  const slice = participants.slice(0, 20);
  slice.forEach((p, idx) => {
    const history = p?.history || [];
    const fallbackPlaces = parseMusiquePlaces(p?.musique || "");
    newClasses[idx] = [0, 1, 2].map((i) => {
      const h = history[i];
      return {
        allocation: h?.allocation || fallbackAllocation,
        valeur: 1000,
        place: h?.place ?? fallbackPlaces[i] ?? 0,
        partants: h?.partants || fallbackPartants,
      };
    });
    horses[idx + 1] = {
      nom: p?.nomCheval || p?.nom || "",
      driver: p?.driver || p?.jockey || "",
      entraineur: p?.entraineur || p?.nomEntraineur || "",
      musique: p?.musique || "",
      cote: p?.cote != null ? Number(p.cote) : null,
      coteRef: p?.dernierRapportReference != null ? Number(p.dernierRapportReference) : null,
      age: p?.age,
      sexe: p?.sexe,
      // Historique enrichi des 3 dernières courses
      history: (p?.history || []).map((h) => ({
        place: h?.place || 0,
        partants: h?.partants || 0,
        allocation: h?.allocation || 0,
        date: h?.date || 0,
        dateIso: h?.dateIso || "",
        daysAgo: h?.daysAgo,
        hippodrome: h?.hippodrome || "",
        discipline: h?.discipline || "",
        distance: h?.distance || 0,
        nomPrix: h?.nomPrix || "",
        etatTerrain: h?.etatTerrain || "",
        driver: h?.driver || "",
      })),
      // Jours de repos = écart depuis la course la plus récente jusqu'à aujourd'hui
      restDays: (() => {
        const h = (p?.history || [])[0];
        return h?.daysAgo != null ? h.daysAgo : null;
      })(),
    };
  });

  return { newClasses, horses, partants: slice.length };
};

const buildCourseInfo = (data, reunion, course) => {
  const c = data?.course || {};
  const hippo = data?.reunion?.hippodrome?.libelleCourt || data?.reunion?.hippodrome?.libelleLong || "";
  const libelle = c?.libelle || c?.libelleCourt || "";
  const distance = c?.distance ? `${c.distance}m` : "";
  const discipline = c?.discipline || c?.specialite || "";
  return [`${reunion}/${course}`, hippo, libelle, [discipline, distance].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" • ");
};

const buildCourseMeta = (data) => {
  const c = data?.course || {};
  return {
    distance: c?.distance || null,
    discipline: c?.discipline || c?.specialite || "",
    allocation: c?.montantPrix || data?.montantPrix || null,
    hippodrome: data?.reunion?.hippodrome?.libelleCourt || data?.reunion?.hippodrome?.libelleLong || "",
    libelle: c?.libelle || c?.libelleCourt || "",
    corde: c?.corde || null,
    parcours: c?.parcours || null,
  };
};

export const PmuScraper = forwardRef(({ onScraped, onContextChange, settingsBtn, historyBtn, exportBtn }, ref) => {
  const { settings } = useSettings();
  const [date, setDate] = useState(todayDDMMYYYY());
  const [reunion, setReunion] = useState("R1");
  const [course, setCourse] = useState("C1");
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [programme, setProgramme] = useState(null);
  const [progLoading, setProgLoading] = useState(false);
  const lastScrapeRef = useRef(null);
  const refreshTimerRef = useRef(null);

  // Charge le programme du jour
  const loadProgramme = async (d) => {
    setProgLoading(true);
    try {
      const resp = await axios.get(`${API}/programme/${d}`);
      setProgramme(resp.data);
    } catch (_) {
      setProgramme(null);
    } finally {
      setProgLoading(false);
    }
  };

  useEffect(() => {
    if (date && date.length === 8) loadProgramme(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Notifie le parent du contexte courant (pour le panneau Arrivées)
  useEffect(() => {
    if (onContextChange) onContextChange({ date, reunion, course });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, reunion, course]);

  // Expose une méthode impérative pour charger une course externe
  useImperativeHandle(ref, () => ({
    loadCourse: async (courseNumber) => {
      const cKey = `C${courseNumber}`;
      setCourse(cKey);
      setLoading(true);
      try {
        lastScrapeRef.current = { date, reunion, course: cKey };
        await doScrape(date, reunion, cKey);
      } catch (_) {} finally { setLoading(false); }
    },
  }));

  const reunionsList = programme?.reunions || [];
  const currentReunion = reunionsList.find((r) => r.reunion === reunion);
  const coursesList = currentReunion?.courses || [];

  const doScrape = async (d, r, c, opts = {}) => {
    const { silent = false, force = false } = opts;
    try {
      const resp = await axios.post(`${API}/scrape-pmu`, {
        date: d, reunion: r, course: c, withHistory: true, forceRefresh: force,
      });
      const data = resp.data;
      if (!data || data.error) throw new Error(data?.error || "Course introuvable");

      const { newClasses, horses, partants } = buildClasses(data);
      const arrivee = Array.isArray(data?.arrivee) ? data.arrivee.slice(0, 7) : [];
      const courseInfo = buildCourseInfo(data, r, c);
      const courseMeta = buildCourseMeta(data);

      onScraped(newClasses, arrivee, courseInfo, horses, { date: d, reunion: r, course: c }, courseMeta);

      if (!silent) {
        if (arrivee.length > 0) {
          toast.success(`${partants} partants - Arrivée: ${arrivee.join("-")} (${r}/${c})`);
        } else {
          toast.success(`${partants} partants - Arrivée non disponible (${r}/${c})`);
        }
      }
      return { arrivee, partants };
    } catch (e) {
      const msg = e?.response?.data?.error || (e instanceof Error ? e.message : "Erreur scraping");
      if (!silent) toast.error(msg);
      throw e;
    }
  };

  const handleScrape = async () => {
    setLoading(true);
    try {
      lastScrapeRef.current = { date, reunion, course };
      await doScrape(date, reunion, course);
    } catch (_) {} finally { setLoading(false); }
  };

  // Auto-refresh tant que arrivée non connue
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!settings.autoRefresh) return;
    const last = lastScrapeRef.current;
    if (!last) return;
    const intervalSec = Math.max(10, settings.refreshInterval || 30);
    refreshTimerRef.current = setInterval(async () => {
      try {
        const r = await doScrape(last.date, last.reunion, last.course, { silent: true, force: true });
        if (r?.arrivee?.length > 0) {
          toast.success(`Arrivée tombée : ${r.arrivee.join("-")}`);
          sendLocalNotification({
            title: `🏆 Arrivée ${last.reunion}/${last.course} !`,
            body: `Top 5 : ${r.arrivee.slice(0, 5).join(" - ")}`,
            tag: `arrivee-${last.date}-${last.reunion}-${last.course}`,
            data: { type: "arrivee", date: last.date, reunion: last.reunion, course: last.course },
          });
          clearInterval(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      } catch (_) {}
    }, intervalSec * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoRefresh, settings.refreshInterval, lastScrapeRef.current]);

  const handleScrapeReunion = async () => {
    if (!coursesList.length) {
      toast.error("Programme indisponible");
      return;
    }
    setBatchLoading(true);
    let saved = 0;
    try {
      for (const c of coursesList) {
        const cKey = `C${c.numero}`;
        try {
          const resp = await axios.post(`${API}/scrape-pmu`, {
            date, reunion, course: cKey, withHistory: true,
          });
          const data = resp.data;
          if (!data || data.error) continue;
          const { newClasses, horses } = buildClasses(data);
          const arrivee = Array.isArray(data?.arrivee) ? data.arrivee.slice(0, 7) : [];
          const courseInfo = buildCourseInfo(data, reunion, cKey);

          // Calcul CAFs pour sauvegarde
          const cafs = newClasses.map((rows) => {
            const totals = rows.map((r2, i) => {
              if (r2.valeur <= 0 || !r2.allocation || !r2.partants) return 0;
              const place = r2.place > 0 ? r2.place : 9;
              const result = (r2.allocation / 1000) * (r2.partants / place) + Math.max(0, r2.partants - place);
              return result * (settings.coefs[i] ?? 1);
            });
            return Math.round(totals.reduce((a, b) => a + b, 0) / (settings.divisor || 6));
          });
          const classement = cafs
            .map((caf, i) => ({ classe: i + 1, caf }))
            .filter((x) => x.caf > 0)
            .sort((a, b) => b.caf - a.caf)
            .map((x) => x.classe);

          const tierceHits = arrivee.slice(0, 3).filter((n) => classement.slice(0, 3).includes(n)).length;
          const top7Hits = arrivee.slice(0, 7).filter((n) => classement.slice(0, 7).includes(n)).length;

          await axios.post(`${API}/pronostics`, {
            date, reunion, course: cKey, courseInfo,
            cafs, classement, arrivee, tierceHits, top7Hits,
          });
          saved += 1;
          // Affiche la dernière course scrapée
          const cMeta = buildCourseMeta(data);
          onScraped(newClasses, arrivee, courseInfo, horses, { date, reunion, course: cKey }, cMeta);
        } catch (_) {}
      }
      toast.success(`Réunion ${reunion} : ${saved}/${coursesList.length} courses scrapées et sauvegardées`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleSelectCourse = (val) => {
    setCourse(`C${val}`);
  };

  const handleSelectReunion = (val) => {
    setReunion(val);
    setCourse("C1");
  };

  return (
    <div className="bg-surface border-2 border-black p-4 mb-4 flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs font-bold flex items-center gap-1">
          <Calendar className="h-3 w-3" /> Date (JJMMAAAA)
        </Label>
        <Input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-32 bg-white"
          placeholder="25032025"
        />
      </div>

      <div>
        <Label className="text-xs font-bold">Réunion</Label>
        {reunionsList.length > 0 ? (
          <Select value={reunion} onValueChange={handleSelectReunion}>
            <SelectTrigger className="w-44 bg-white">
              <SelectValue placeholder={progLoading ? "..." : "R1"} />
            </SelectTrigger>
            <SelectContent>
              {reunionsList.map((r) => (
                <SelectItem key={r.reunion} value={r.reunion}>
                  {r.reunion} — {r.hippodrome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={reunion}
            onChange={(e) => setReunion(e.target.value.toUpperCase())}
            className="w-20 bg-white"
            placeholder="R1"
          />
        )}
      </div>

      <div>
        <Label className="text-xs font-bold">Course</Label>
        {coursesList.length > 0 ? (
          <Select value={course.replace("C", "")} onValueChange={handleSelectCourse}>
            <SelectTrigger className="w-44 bg-white">
              <SelectValue placeholder="C1" />
            </SelectTrigger>
            <SelectContent>
              {coursesList.map((c) => (
                <SelectItem key={c.numero} value={String(c.numero)}>
                  C{c.numero} — {c.libelle?.slice(0, 28) || ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={course}
            onChange={(e) => setCourse(e.target.value.toUpperCase())}
            className="w-20 bg-white"
            placeholder="C1"
          />
        )}
      </div>

      <Button
        onClick={handleScrape}
        disabled={loading || batchLoading}
        className="bg-caf-green hover:bg-caf-green/90 text-caf-green-foreground font-bold transition-transform active:scale-95"
      >
        {loading ? (
          <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Scraping...</>
        ) : (
          "Wague PMU"
        )}
      </Button>

      <Button
        onClick={handleScrapeReunion}
        disabled={loading || batchLoading || !coursesList.length}
        variant="outline"
        className="border-2 border-black bg-yellow-200 hover:bg-yellow-300 font-bold transition-transform active:scale-95"
        title="Scraper et sauvegarder toutes les courses de la réunion"
      >
        {batchLoading ? (
          <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> {reunion}...</>
        ) : (
          <><Layers className="h-4 w-4 mr-1" /> Réunion entière</>
        )}
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {settings.autoRefresh && refreshTimerRef.current && (
          <span className="text-xs text-green-700 font-bold flex items-center gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" /> Auto {settings.refreshInterval}s
          </span>
        )}
        {exportBtn}
        {historyBtn}
        {settingsBtn}
      </div>
    </div>
  );
});

PmuScraper.displayName = "PmuScraper";

