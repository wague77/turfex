"use client";

/**
 * LiveSendStatus — badge live qui poll /api/admin/digest-runs/latest toutes les 5s.
 *
 * Affiche :
 *  - Pendant un envoi en cours : "Envoi en cours… 4/10 envoyés" + barre de progression
 *  - Après completion (60s window) : "Dernier envoi : 11 ok · 0 erreur"
 *  - Idle : rien (composant invisible)
 *
 * Peut être inséré dans TrialsPanel et SubscribersPanel pour une visibilité globale.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

export default function LiveSendStatus({ token }) {
  const [state, setState] = useState(null);
  const [sendMode, setSendMode] = useState(null);
  const [tick, setTick] = useState(0);

  // Fetch send mode once (static between reloads)
  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/admin/send-mode`, {
        headers: { "X-Admin-Password": token },
        timeout: 5000,
      })
      .then(({ data }) => setSendMode(data))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    let cancel = false;
    let pollInterval = 5000;

    const poll = async () => {
      try {
        const { data } = await axios.get(`${API}/admin/digest-runs/latest`, {
          headers: { "X-Admin-Password": token },
          timeout: 8000,
        });
        if (!cancel) setState(data);
        // Poll plus rapidement pendant un envoi actif
        pollInterval = data?.active ? 3000 : 8000;
      } catch (_) {
        // ignore polling errors
      } finally {
        if (!cancel) {
          setTimeout(() => setTick((t) => t + 1), pollInterval);
        }
      }
    };
    poll();
    return () => { cancel = true; };
  }, [tick, token]);

  if (!state) {
    // If no state yet but we know send mode, show just the mode badge
    if (sendMode?.adminManualOnly) {
      return (
        <div
          className="border-2 border-amber-500 bg-amber-50 rounded-lg px-4 py-2 mb-4 flex items-center gap-2 text-sm"
          data-testid="admin-manual-only-badge"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          <span className="font-bold text-amber-900">MODE ADMIN MANUEL</span>
          <span className="text-amber-800">· CRON désactivés · envois uniquement via tes clics</span>
        </div>
      );
    }
    return null;
  }

  const { active, sentLive, errorsLive, recipientsCount, sent, errors, ok, completedAt, startedAt, recentRecipients } = state;

  // Hide if no recent activity (>5 min after completion)
  if (!active && completedAt) {
    const ageMs = Date.now() - new Date(completedAt).getTime();
    if (ageMs > 5 * 60 * 1000) return null;
  }
  if (!active && !startedAt) return null;

  const target = recipientsCount || (active && state.trigger?.includes("bulk") ? 10 : 1);
  const progressPct = target > 0 ? Math.min(100, ((active ? sentLive : sent) / target) * 100) : 0;

  if (active) {
    return (
      <>
        {sendMode?.adminManualOnly && (
          <div
            className="border-2 border-amber-500 bg-amber-50 rounded-lg px-4 py-2 mb-3 flex items-center gap-2 text-sm"
            data-testid="admin-manual-only-badge"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            <span className="font-bold text-amber-900">MODE ADMIN MANUEL</span>
            <span className="text-amber-800">· CRON désactivés</span>
          </div>
        )}
        <div
          className="border-2 border-blue-500 bg-blue-50 rounded-lg px-4 py-3 mb-4 shadow-sm"
          data-testid="live-send-status"
        >
        <div className="flex items-center gap-3 mb-2">
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-blue-900 text-sm">
              Envoi en cours · {sentLive} envoyé(s)
              {errorsLive > 0 && <span className="text-red-600 ml-2">· {errorsLive} erreur(s)</span>}
            </div>
            <div className="text-xs text-blue-700 mt-0.5 truncate">
              {recentRecipients?.length > 0
                ? `Dernier : ${recentRecipients[0]}`
                : "Préparation des emails…"}
            </div>
          </div>
        </div>
        <div className="h-1.5 bg-blue-100 rounded overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-500"
            style={{ width: `${Math.max(progressPct, 5)}%` }}
          />
        </div>
        </div>
      </>
    );
  }

  // Completed (within 5 min window)
  const isOk = ok && (errors === 0 || !errors);
  return (
    <>
      {sendMode?.adminManualOnly && (
        <div
          className="border-2 border-amber-500 bg-amber-50 rounded-lg px-4 py-2 mb-3 flex items-center gap-2 text-sm"
          data-testid="admin-manual-only-badge"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          <span className="font-bold text-amber-900">MODE ADMIN MANUEL</span>
          <span className="text-amber-800">· CRON désactivés</span>
        </div>
      )}
      <div
        className={`border-2 rounded-lg px-4 py-3 mb-4 shadow-sm ${
          isOk ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"
        }`}
        data-testid="live-send-status-completed"
      >
      <div className="flex items-center gap-3">
        {isOk ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className={`font-bold text-sm ${isOk ? "text-emerald-900" : "text-amber-900"}`}>
            Dernier envoi : {sent ?? 0} email(s) délivré(s)
            {errors > 0 && <span className="text-red-700 ml-2">· {errors} erreur(s)</span>}
          </div>
          <div className={`text-xs mt-0.5 ${isOk ? "text-emerald-700" : "text-amber-700"}`}>
            Terminé {completedAt ? new Date(completedAt).toLocaleTimeString("fr-FR") : "à l'instant"}
            {state.hippodrome && ` · ${state.hippodrome}`}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

