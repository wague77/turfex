"use client";

// PORTAGE FIDÈLE de src/pages/Index.tsx (TURFEX SOURCE)
// Différences (forcées par la stack) :
//  - import.meta.env.VITE_SUPABASE_URL → process.env.NEXT_PUBLIC_BACKEND_URL
//  - endpoint Supabase /functions/v1/pmu-participants → POST /api/scrape-pmu (proxy backend équivalent)
//  - TS → JS (suppression types only)
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { HeroIntelligence } from "@/components/HeroIntelligence";
import { DashboardIntelligence } from "@/components/DashboardIntelligence";
import { scoreParticipants } from "@/lib/pronostics-source";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const DEFAULT_DATE = "25032025";

const parseDDMMYYYY = (s) => {
  const d = parseInt(s.slice(0, 2), 10);
  const m = parseInt(s.slice(2, 4), 10) - 1;
  const y = parseInt(s.slice(4), 10);
  return new Date(y, m, d);
};

const toDDMMYYYY = (d) =>
  `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;

export const IntelligencePanel = () => {
  const dashboardRef = useRef(null);
  const [selectedDate, setSelectedDate] = useState(parseDDMMYYYY(DEFAULT_DATE));
  const [reunion, setReunion] = useState("R1");
  const [course, setCourse] = useState("C1");
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState(null);

  const date = toDDMMYYYY(selectedDate);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Backend proxy (équivalent de l'edge function Supabase pmu-participants)
      const res = await axios.post(
        `${API}/scrape-pmu`,
        { date, reunion, course, withHistory: false, forceRefresh: false },
        { timeout: 25000 }
      );

      const json = res.data;
      const raw = json.participants ?? [];
      const scored = scoreParticipants(raw);

      setParticipants(scored);

      if (scored.length === 0) {
        toast.warning("Aucun partant trouvé pour cette course.");
      } else {
        toast.success(`${scored.length} partants analysés`);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.detail ||
        e?.message ||
        "Erreur inconnue";
      setError(msg);
      toast.error("Erreur lors du chargement", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [course, date, reunion]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const scrollToDashboard = () => {
    dashboardRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-[60vh]" data-testid="intelligence-panel">
      {/* SEO */}
      <h1 className="sr-only">TurfeX Intelligence — Pronostics Wague et analyses IA</h1>

      <HeroIntelligence
        onLaunch={scrollToDashboard}
        topPredictions={participants.slice(0, 3)}
        loading={loading}
      />

      <div ref={dashboardRef}>
        <DashboardIntelligence
          selectedDate={selectedDate}
          reunion={reunion}
          course={course}
          loading={loading}
          participants={participants}
          error={error}
          onDateChange={setSelectedDate}
          onReunionChange={setReunion}
          onCourseChange={setCourse}
          onRefresh={fetchData}
        />
      </div>

      <footer className="border-t border-zinc-800/50 mt-6 py-6 text-center text-xs text-zinc-500">
        <p>
          TurfeX Intelligence © 2026 · Données fournies par Wague ·{" "}
          <span className="text-amber-400">Logiciel N°1 des parieurs</span>
        </p>
      </footer>
    </main>
  );
};

export default IntelligencePanel;

