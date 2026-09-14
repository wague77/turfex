"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Trophy, Clock, RefreshCw, ChevronDown, ChevronUp, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const ARRIVEE_COLORS = [
  "bg-yellow-300 text-black border-yellow-700",
  "bg-gray-300 text-black border-gray-500",
  "bg-orange-400 text-black border-orange-700",
  "bg-green-300 text-black border-green-700",
  "bg-blue-300 text-black border-blue-700",
  "bg-purple-300 text-black border-purple-700",
  "bg-pink-300 text-black border-pink-700",
];

const fmtHour = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
};

export const ArriveesPanel = ({ date, reunion, onLoadCourse, autoRefresh = true }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const timerRef = useRef(null);

  const load = async (silent = false) => {
    if (!date || !reunion) return;
    if (!silent) setLoading(true);
    try {
      const resp = await axios.get(`${API}/arrivees/${date}/${reunion}`);
      setData(resp.data);
      setLastUpdate(new Date());
    } catch (_) {
      // silent
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) {
      // Vérifie toutes les 60s les nouvelles arrivées
      timerRef.current = setInterval(() => load(true), 60000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line
  }, [date, reunion, autoRefresh]);

  if (!date || !reunion) return null;
  if (!data && !loading) return null;

  const courses = data?.courses || [];
  const finished = courses.filter((c) => c.termine).length;
  const total = courses.length;

  return (
    <div className="border-2 border-black rounded bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full bg-black text-white px-3 py-2 flex items-center gap-2 text-sm font-bold hover:bg-black/85 transition-colors"
      >
        <Trophy className="h-4 w-4 text-yellow-300" />
        <span className="flex-1 text-left">
          Arrivées {data?.reunion} {data?.hippodrome ? `— ${data.hippodrome}` : ""}
        </span>
        <span className="text-xs font-mono opacity-80">
          {finished}/{total} terminées
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <>
          <div className="p-2 space-y-1.5 max-h-[600px] overflow-y-auto">
            {courses.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-3">
                Aucune course dans le programme
              </p>
            )}
            {courses.map((c) => {
              const arr = c.arrivee || [];
              return (
                <div
                  key={c.numero}
                  className={`border border-black/40 rounded px-2 py-1.5 transition-colors ${
                    c.termine ? "bg-white" : "bg-yellow-50/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm font-mono bg-classe-yellow text-classe-yellow-foreground px-1.5 rounded">
                      C{c.numero}
                    </span>
                    {c.heureDepart && (
                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 font-mono">
                        <Clock className="h-2.5 w-2.5" />
                        {fmtHour(c.heureDepart)}
                      </span>
                    )}
                    <span className="text-xs flex-1 truncate" title={c.libelle}>
                      {c.libelle || ""}
                    </span>
                    {c.discipline && (
                      <span className="text-[9px] uppercase tracking-wide bg-gray-200 px-1 rounded">
                        {String(c.discipline).slice(0, 6)}
                      </span>
                    )}
                    {onLoadCourse && (
                      <button
                        type="button"
                        onClick={() => onLoadCourse(c.numero)}
                        className="text-[10px] px-1.5 py-0.5 bg-caf-green text-caf-green-foreground rounded hover:opacity-90 font-bold"
                        title={`Charger C${c.numero} dans le calculateur`}
                      >
                        Charger
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {c.termine ? (
                      arr.slice(0, 7).map((n, i) => (
                        <span
                          key={i}
                          className={`inline-flex flex-col items-center justify-center min-w-[34px] px-1.5 py-0.5 rounded border-2 font-bold text-sm ${ARRIVEE_COLORS[i] || "bg-gray-100"}`}
                        >
                          <span className="text-[8px] uppercase opacity-70">{i + 1}</span>
                          <span className="text-base leading-none">{n}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1 italic">
                        <Hourglass className="h-3 w-3 animate-pulse" />
                        En attente d'arrivée…
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-black/5 px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between border-t border-black/10">
            <span>
              {lastUpdate ? `Mis à jour ${lastUpdate.toLocaleTimeString("fr-FR")}` : ""}
              {autoRefresh && total > finished && " • auto 60s"}
            </span>
            <button
              type="button"
              onClick={() => load(false)}
              disabled={loading}
              className="hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Rafraîchir
            </button>
          </div>
        </>
      )}
    </div>
  );
};

