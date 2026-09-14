"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Users,
  ChevronDown,
  ChevronUp,
  Clock,
  Wifi,
  RefreshCw,
} from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const POLL_MS = 15_000; // refresh toutes les 15s

const formatRelative = (sec) => {
  if (sec == null) return "—";
  if (sec < 60) return `il y a ${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `il y a ${m}min`;
  return `il y a ${Math.floor(m / 60)}h`;
};

export function OnlineUsersPanel({ token }) {
  const [open, setOpen] = useState(true); // ouvert par défaut (compteur visible)
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const headers = useMemo(() => (token ? { "X-Admin-Password": token } : {}), [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data: resp } = await axios.get(`${API}/admin/online-users?window_minutes=5`, {
        headers,
      });
      setData(resp);
    } catch {
      // silencieux pour ne pas spammer
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  // Auto-refresh
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const onlineCount = data?.onlineCount ?? 0;

  return (
    <section
      data-testid="online-users-panel"
      className="max-w-6xl mx-auto bg-white border-2 border-black rounded-xl p-4 mb-6"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            data-testid="online-users-toggle"
            className="w-full flex items-center justify-between gap-3 py-1 text-left"
          >
            <div className="flex items-center gap-3">
              <div
                className={`relative h-10 w-10 rounded-lg flex items-center justify-center text-white shadow ${
                  onlineCount > 0
                    ? "bg-gradient-to-br from-green-500 to-emerald-600"
                    : "bg-gradient-to-br from-gray-500 to-gray-600"
                }`}
              >
                <Users className="h-5 w-5" />
                {onlineCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 border-2 border-white"></span>
                  </span>
                )}
              </div>
              <div>
                <div className="font-extrabold text-lg flex items-center gap-2">
                  Utilisateurs en ligne
                  <span
                    className={`text-2xl font-black tabular-nums ${
                      onlineCount > 0 ? "text-green-600" : "text-gray-400"
                    }`}
                    data-testid="online-users-count"
                  >
                    {onlineCount}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  Activité &lt; 5 min · Heure : {data?.activeLastHour ?? "—"} · 24h : {data?.activeLast24h ?? "—"} · Total connus : {data?.totalKnown ?? "—"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  load();
                }}
                disabled={loading}
                className="h-8 text-xs"
                data-testid="online-users-refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
              {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-4">
          {data?.online && data.online.length > 0 ? (
            <div className="border-2 border-black rounded-lg overflow-hidden">
              <div className="grid grid-cols-[140px_1fr_120px_90px_1fr] gap-2 bg-black text-white text-[10px] uppercase font-bold px-3 py-2">
                <div>Code</div>
                <div>Label</div>
                <div>Dernier ping</div>
                <div>Pings</div>
                <div>IP</div>
              </div>
              {data.online.map((u, idx) => (
                <div
                  key={u.code}
                  data-testid={`online-user-row-${idx}`}
                  className={`grid grid-cols-[140px_1fr_120px_90px_1fr] gap-2 items-center px-3 py-2 text-[12px] border-t border-gray-200 ${
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                  }`}
                >
                  <div className="font-mono font-bold flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                    </span>
                    {u.code}
                  </div>
                  <div className="text-gray-700 truncate">{u.label || "—"}</div>
                  <div className="flex items-center gap-1 text-gray-600">
                    <Clock className="h-3 w-3" />
                    {formatRelative(u.secondsAgo)}
                  </div>
                  <div className="font-mono text-center text-gray-600">{u.pingCount}</div>
                  <div className="font-mono text-[10px] text-gray-500 truncate" title={u.ip}>
                    {u.ip || "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-sm text-gray-500">
              <Wifi className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Aucun utilisateur connecté actuellement.
              <div className="text-[11px] text-gray-400 mt-2 italic">
                Le compteur se met à jour toutes les 15s.<br />
                Le watchdog ping toutes les 60s côté frontend → un utilisateur disparaît si son onglet est fermé/inactif &gt; 5 min.
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export default OnlineUsersPanel;

