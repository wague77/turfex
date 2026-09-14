"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { analyzeHorse, computeCourseDifficulty, computeStables } from "@/lib/analytics";
import { Cloud, CloudRain, CloudSnow, Sun, Wind, Droplets, Thermometer, Users, Flag, AlertTriangle, Trophy } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const WeatherIcon = ({ code, size = "h-6 w-6" }) => {
  const c = Number(code) || 0;
  if (c >= 95) return <CloudRain className={`${size} text-purple-600`} />;
  if (c >= 80) return <CloudRain className={`${size} text-blue-700`} />;
  if (c >= 71) return <CloudSnow className={`${size} text-blue-200`} />;
  if (c >= 51) return <CloudRain className={`${size} text-blue-500`} />;
  if (c >= 45) return <Cloud className={`${size} text-gray-500`} />;
  if (c >= 2) return <Cloud className={`${size} text-gray-400`} />;
  return <Sun className={`${size} text-yellow-500`} />;
};

const terrainColor = (t) => {
  switch (t) {
    case "sec": return "bg-yellow-200 text-yellow-900";
    case "bon": return "bg-green-200 text-green-900";
    case "souple": return "bg-blue-200 text-blue-900";
    case "lourd": return "bg-orange-300 text-orange-900";
    case "très lourd": return "bg-red-300 text-red-900";
    default: return "bg-gray-200 text-gray-700";
  }
};

export const CourseAnalysis = ({ horses = {}, cafs = [], currentCourse = {}, scraperCtx = {} }) => {
  const [weather, setWeather] = useState(null);
  const [wLoading, setWLoading] = useState(false);

  const hippo = currentCourse?.hippodrome;
  const date = scraperCtx?.date;

  // Fetch météo quand hippodrome + date changent
  useEffect(() => {
    if (!hippo || !date) { setWeather(null); return; }
    let cancelled = false;
    const load = async () => {
      setWLoading(true);
      try {
        const resp = await axios.get(`${API}/weather`, { params: { hippodrome: hippo, date } });
        if (!cancelled) setWeather(resp.data?.error ? null : resp.data);
      } catch (_) {
        if (!cancelled) setWeather(null);
      } finally {
        if (!cancelled) setWLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hippo, date]);

  const analyzed = useMemo(() => {
    const allCafs = cafs.map((c, i) => ({ classe: i + 1, caf: c }));
    const sortedByCaf = [...allCafs].sort((a, b) => b.caf - a.caf);
    const cafRankMap = {};
    sortedByCaf.forEach((it, idx) => { if (it.caf > 0) cafRankMap[it.classe] = idx + 1; });
    const totalCount = sortedByCaf.filter((x) => x.caf > 0).length;
    return Object.entries(horses)
      .map(([k, h]) => ({ num: Number(k), ...h, caf: cafs[Number(k) - 1] }))
      .filter((r) => r.nom)
      .map((r) => ({ ...r, cafRank: cafRankMap[r.num], totalCount, ...analyzeHorse(r, { cafRank: cafRankMap[r.num], totalCount, currentCourse }) }));
  }, [horses, cafs, currentCourse]);

  const difficulty = useMemo(() => computeCourseDifficulty(analyzed, currentCourse), [analyzed, currentCourse]);
  const stables = useMemo(() => computeStables(analyzed), [analyzed]);

  if (analyzed.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-slate-900 to-black border-4 border-black rounded overflow-hidden shadow-2xl mb-4">
      {/* Ligne du haut : difficulté + météo */}
      <div className="flex flex-wrap items-stretch">
        {/* Difficulté */}
        {difficulty && (
          <div className="flex-1 min-w-[260px] p-4 border-r border-white/20">
            <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest mb-1">
              Indice de difficulté
            </div>
            <div className={`inline-block px-4 py-2 rounded-lg font-extrabold text-2xl border-2 border-black ${difficulty.colorBadge} shadow-lg`}>
              {difficulty.badge}
            </div>
            <div className="text-white/80 text-xs mt-2 font-bold">
              Score : {difficulty.score}/100
            </div>
            <div className="bg-white/10 rounded mt-2 p-2 text-xs text-white">
              <div className="font-bold mb-1">📋 {difficulty.strategy.title}</div>
              <ul className="space-y-0.5">
                {difficulty.strategy.bets.map((b, i) => (
                  <li key={i} className="opacity-90" dangerouslySetInnerHTML={{ __html: b.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Météo */}
        <div className="flex-1 min-w-[260px] p-4 border-r border-white/20">
          <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest mb-1">
            Météo & terrain
          </div>
          {wLoading ? (
            <div className="text-white/60 text-sm italic">Chargement météo...</div>
          ) : weather ? (
            <div>
              <div className="flex items-center gap-3">
                <WeatherIcon code={weather.weatherCode} size="h-14 w-14" />
                <div>
                  <div className="text-white font-bold text-lg">{weather.weatherLabel}</div>
                  <div className="text-white/70 text-xs">{hippo} • {weather.date}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-white/10 rounded p-2 text-white text-xs flex items-center gap-1">
                  <Thermometer className="h-3 w-3" />
                  {weather.tempMin?.toFixed(0) ?? "?"}° / {weather.tempMax?.toFixed(0) ?? "?"}°
                </div>
                <div className="bg-white/10 rounded p-2 text-white text-xs flex items-center gap-1">
                  <Wind className="h-3 w-3" />
                  {weather.windMax?.toFixed(0) ?? "?"} km/h
                </div>
                <div className="bg-white/10 rounded p-2 text-white text-xs flex items-center gap-1">
                  <Droplets className="h-3 w-3" />
                  {weather.precipitation?.toFixed(1) ?? "?"} mm
                </div>
                <div className={`rounded p-2 text-xs flex items-center gap-1 font-bold ${terrainColor(weather.terrainEstime)}`}>
                  <Flag className="h-3 w-3" />
                  Terrain {weather.terrainEstime}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-white/50 text-sm italic">Météo indisponible pour cet hippodrome</div>
          )}
        </div>

        {/* Écuries + drivers */}
        <div className="flex-1 min-w-[260px] p-4">
          <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest mb-1">
            Écuries du jour
          </div>
          {stables.entraineurs.length === 0 && stables.drivers.length === 0 ? (
            <div className="text-white/50 text-sm italic">Aucun double engagement</div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {stables.entraineurs.slice(0, 3).map((s) => (
                <div key={s.nom} className="bg-white/10 rounded p-2 text-xs">
                  <div className="text-white flex items-center gap-1">
                    <Users className="h-3 w-3 text-yellow-300" />
                    <span className="font-bold">{s.nom}</span>
                    <span className="ml-auto bg-yellow-400 text-black px-1.5 rounded text-[10px] font-bold">
                      {s.count} chevaux
                    </span>
                  </div>
                  <div className="text-white/70 mt-1">
                    N° {s.nums.join(", ")}
                  </div>
                </div>
              ))}
              {stables.drivers.slice(0, 2).map((s) => (
                <div key={s.nom} className="bg-white/10 rounded p-2 text-xs">
                  <div className="text-white flex items-center gap-1">
                    <Trophy className="h-3 w-3 text-cyan-300" />
                    <span className="font-bold">🏇 {s.nom}</span>
                    <span className="ml-auto bg-cyan-400 text-black px-1.5 rounded text-[10px] font-bold">
                      {s.count} montes
                    </span>
                  </div>
                  <div className="text-white/70 mt-1">
                    N° {s.nums.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Détails du calcul de difficulté */}
      {difficulty && difficulty.details.length > 0 && (
        <div className="bg-black/50 px-4 py-2 text-[11px] text-white/70 border-t border-white/10 flex flex-wrap gap-x-3 gap-y-1">
          <span className="font-bold text-white/90">Calcul :</span>
          {difficulty.details.map((d, i) => (
            <span key={i}>
              {d.icon} {d.text}{d.weight > 0 ? ` (+${d.weight})` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

