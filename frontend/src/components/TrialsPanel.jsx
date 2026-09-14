"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Gift,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Clock,
  Ban,
  CornerDownRight,
  Search,
  Send,
  MailCheck,
  UserPlus,
  Activity,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import LiveSendStatus from "@/components/LiveSendStatus";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const trialStatus = (t, today) => {
  if (!t.active) return { label: "Désactivé", color: "bg-gray-300 text-gray-800", Icon: Ban };
  if (t.trialUsed) return { label: "Envoyé", color: "bg-green-200 text-green-900", Icon: CheckCircle2 };
  if (t.trialDate && t.trialDate <= today)
    return { label: "À envoyer aujourd'hui", color: "bg-yellow-200 text-yellow-900", Icon: Clock };
  return { label: "En attente", color: "bg-blue-200 text-blue-900", Icon: Clock };
};

export const TrialsPanel = ({ token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const authHeaders = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/admin/trials`, authHeaders);
      setData(resp.data);
    } catch (err) {
      toast.error("Erreur chargement trials", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [token]);

  // === Inscription manuelle rapide ===
  const [manualEmail, setManualEmail] = useState("");
  const [manualSendNow, setManualSendNow] = useState(false);
  const [addingManual, setAddingManual] = useState(false);

  const handleAddManual = async () => {
    const em = manualEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) {
      toast.error("Email invalide");
      return;
    }
    setAddingManual(true);
    try {
      const { data: resp } = await axios.post(
        `${API}/admin/trials/add`,
        { email: em, sendNow: manualSendNow },
        { ...authHeaders, timeout: 30000 }
      );
      const statusLabel = resp.status === "created" ? "créé" : "réactivé";
      if (manualSendNow && resp.sendResult?.queued) {
        toast.success(`Trial ${statusLabel} + envoi lancé`, {
          description: "L'envoi tourne en arrière-plan (~30-60s). Rafraîchis la liste.",
          duration: 6000,
        });
        setTimeout(() => load().catch(() => {}), 60000);
      } else if (manualSendNow && resp.sendResult?.ok) {
        toast.success(`Trial ${statusLabel} + email envoyé`, {
          description: `${resp.sendResult.sent || 0} destinataires au total.`,
        });
      } else {
        toast.success(`Trial ${statusLabel}`, {
          description: `trialDate = ${resp.trialDate}${manualSendNow ? " (envoi en cours)" : ""}`,
        });
      }
      setManualEmail("");
      setManualSendNow(false);
      await load();
    } catch (err) {
      toast.error("Erreur inscription", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setAddingManual(false);
    }
  };

  // === Historique tentatives (audit log) ===
  const [eventsOpen, setEventsOpen] = useState(false);
  const [events, setEvents] = useState(null);

  const loadEvents = async () => {
    try {
      const { data: resp } = await axios.get(`${API}/admin/trials/events?limit=30`, authHeaders);
      setEvents(resp);
    } catch (err) {
      toast.error("Erreur chargement historique");
    }
  };

  const handleToggle = async (t) => {
    try {
      await axios.patch(
        `${API}/admin/trials/${t.id}`,
        { active: !t.active },
        authHeaders
      );
      await load();
    } catch (_) {
      toast.error("Erreur mise à jour");
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Supprimer le trial ${t.email} ?`)) return;
    try {
      await axios.delete(`${API}/admin/trials/${t.id}`, authHeaders);
      toast.success("Supprimé");
      await load();
    } catch (_) {
      toast.error("Erreur suppression");
    }
  };

  const handlePromote = async (t) => {
    if (!window.confirm(`Convertir ${t.email} en abonné permanent ?`)) return;
    try {
      const resp = await axios.post(`${API}/admin/trials/${t.id}/promote`, {}, authHeaders);
      if (resp.data?.already) {
        toast.info("Déjà abonné");
      } else {
        toast.success("Promu en abonné");
      }
    } catch (err) {
      toast.error("Erreur promotion", {
        description: err?.response?.data?.detail || err?.message,
      });
    }
  };

  const [sendingId, setSendingId] = useState(null);
  const [sendingBulk, setSendingBulk] = useState(false);

  const handleResend = async (t) => {
    if (!window.confirm(`Renvoyer le digest R1 maintenant à ${t.email} ?`)) return;
    setSendingId(t.id);
    try {
      const { data } = await axios.post(
        `${API}/admin/trials/send-now`,
        { trial_id: t.id },
        { ...authHeaders, timeout: 30000 }
      );
      if (data.ok && data.queued) {
        toast.success(`Envoi lancé pour ${t.email}`, {
          description: "L'envoi tourne en arrière-plan (~10-30s). Rafraîchis la liste.",
          duration: 6000,
        });
        setTimeout(() => load().catch(() => {}), 30000);
      } else if (data.ok) {
        toast.success(`Email envoyé à ${t.email}`, {
          description: `${data.sent || 0} destinataires en tout · ${data.sent_trials || 0} trials.`,
        });
      } else {
        toast.error("Envoi échoué", {
          description: (data.errors && data.errors[0]?.error) || "Aucun email envoyé",
        });
      }
      await load();
    } catch (err) {
      toast.error("Erreur renvoi", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSendingId(null);
    }
  };

  const handleResendAllPending = async () => {
    const activeTrials = (data?.items || []).filter((t) => t.active);
    if (!activeTrials.length) {
      toast.info("Aucun trial actif.");
      return;
    }
    if (!window.confirm(
      `Renvoyer le digest R1 maintenant à ${activeTrials.length} trial(s) actif(s) ?\n\n` +
      `Cela FORCE l'envoi même aux trials déjà marqués "utilisés" (reset trialUsed=false).\n` +
      `L'envoi tourne en arrière-plan — rafraîchis la liste dans 30-60s pour voir les résultats.`
    )) return;
    setSendingBulk(true);
    try {
      const { data: resp } = await axios.post(
        `${API}/admin/trials/send-now`,
        { all_pending: true, reset_used: true },
        { ...authHeaders, timeout: 30000 }
      );
      if (resp.ok && resp.queued) {
        toast.success(
          `Envoi lancé pour ${resp.targeted_count || activeTrials.length} trial(s)`,
          {
            description:
              "L'envoi tourne en arrière-plan (30-60s). Rafraîchis la liste pour voir le statut.",
            duration: 8000,
          }
        );
        // Rafraîchit automatiquement après 60s
        setTimeout(() => load().catch(() => {}), 60000);
      } else if (resp.ok) {
        toast.success(
          `${resp.sent_trials || 0} trial(s) envoyé(s) · ${resp.sent || 0} emails au total`,
          { description: `Hippodrome : ${resp.hippodrome || "-"} · ${resp.errors?.length || 0} erreur(s).` }
        );
      } else {
        toast.error("Envoi bulk échoué", {
          description: resp.errors?.[0]?.error || "Aucun email envoyé",
        });
      }
      await load();
    } catch (err) {
      toast.error("Erreur envoi bulk", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSendingBulk(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    const today = data.today;
    let arr = data.items.slice();
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      arr = arr.filter((t) => (t.email || "").toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      arr = arr.filter((t) => {
        if (statusFilter === "pending") return t.active && !t.trialUsed;
        if (statusFilter === "used") return t.trialUsed;
        if (statusFilter === "disabled") return !t.active;
        return true;
      });
    }
    return arr.map((t) => ({ ...t, status: trialStatus(t, today) }));
  }, [data, filter, statusFilter]);

  if (!data) {
    return (
      <section
        className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-3 mb-6 text-xs italic text-muted-foreground"
        data-testid="trials-panel-loading"
      >
        Chargement trials visiteurs…
      </section>
    );
  }

  const { stats, today } = data;

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="trials-panel"
    >
      <LiveSendStatus token={token} />
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Gift className="h-5 w-5 text-row-pink" />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-base">Trials visiteurs (test gratuit · 1 jour)</h2>
          <p className="text-xs text-muted-foreground">
            Emails captés depuis la page de login. Reçoivent les pronostics R1 le matin du{" "}
            <code className="bg-muted px-1 font-mono">trialDate</code> à 08h00 Paris.
          </p>
        </div>
        <Button
          onClick={handleResendAllPending}
          disabled={sendingBulk || (stats?.active || 0) === 0}
          size="sm"
          className="bg-gradient-to-r from-blue-500 to-violet-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
          data-testid="trials-bulk-resend-btn"
          title="Renvoyer le digest R1 à tous les trials actifs (force reset trialUsed=false)"
        >
          {sendingBulk ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <MailCheck className="h-3.5 w-3.5 mr-1" />
          )}
          {sendingBulk ? "Envoi en cours…" : `Renvoyer à tous (${stats?.active || 0} actifs)`}
        </Button>
        <Button
          onClick={load}
          variant="outline"
          size="sm"
          className="bg-white border-2 border-black"
          disabled={loading}
          data-testid="trials-refresh-btn"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* INSCRIPTION MANUELLE RAPIDE */}
      <div className="mb-3 p-3 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg" data-testid="trial-manual-add">
        <div className="flex items-center gap-2 mb-2">
          <UserPlus className="h-4 w-4 text-green-700" />
          <span className="text-xs font-bold uppercase text-green-900">
            Inscription manuelle rapide
          </span>
          <span className="text-[11px] text-green-700 italic ml-auto">
            Utile si un ami veut s'inscrire sans passer par le formulaire
          </span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            type="email"
            placeholder="email@exemple.com"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !addingManual) handleAddManual(); }}
            className="flex-1 min-w-[220px] h-8 text-sm border-2 border-black"
            data-testid="trial-manual-email-input"
          />
          <label className="flex items-center gap-1 text-xs font-semibold cursor-pointer" title="Envoi le digest R1 immédiatement (sinon demain 08h00)">
            <input
              type="checkbox"
              checked={manualSendNow}
              onChange={(e) => setManualSendNow(e.target.checked)}
              className="h-4 w-4"
              data-testid="trial-manual-sendnow"
            />
            Envoi immédiat
          </label>
          <Button
            onClick={handleAddManual}
            disabled={addingManual || !manualEmail.trim()}
            size="sm"
            className="h-8 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 font-bold border-2 border-black"
            data-testid="trial-manual-add-btn"
          >
            {addingManual ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5 mr-1" />
            )}
            {addingManual ? "Inscription…" : "Inscrire"}
          </Button>
        </div>
      </div>

      {/* AUDIT LOG TOGGLE */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => {
            setEventsOpen((v) => !v);
            if (!events) loadEvents();
          }}
          className="flex items-center gap-2 text-xs font-bold text-violet-700 hover:text-violet-900 underline"
          data-testid="trial-events-toggle"
        >
          <Activity className="h-3.5 w-3.5" />
          {eventsOpen ? "Masquer" : "Voir"} l'historique des tentatives d'inscription
          {events?.totalByOutcome && (
            <span className="text-[10px] text-gray-500 font-normal">
              ({Object.values(events.totalByOutcome).reduce((s, n) => s + n, 0)} tentatives loguées)
            </span>
          )}
        </button>
        {eventsOpen && events && (
          <div className="mt-2 border-2 border-violet-300 rounded-lg overflow-hidden bg-violet-50" data-testid="trial-events-panel">
            <div className="px-3 py-2 bg-violet-600 text-white text-[11px] font-bold uppercase flex flex-wrap gap-3">
              {Object.entries(events.totalByOutcome || {}).map(([k, v]) => (
                <span key={k} className="bg-white/20 px-2 py-0.5 rounded">
                  {k}: {v}
                </span>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-violet-200 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Date</th>
                    <th className="text-left px-2 py-1">Email</th>
                    <th className="text-left px-2 py-1">Outcome</th>
                    <th className="text-left px-2 py-1">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.items || []).map((e, i) => (
                    <tr key={e.id || i} className={i % 2 === 0 ? "bg-white" : "bg-violet-50"}>
                      <td className="px-2 py-1 font-mono">{(e.createdAt || "").slice(0, 19)}</td>
                      <td className="px-2 py-1">{e.email || "—"}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          e.outcome === "created" ? "bg-green-200 text-green-900" :
                          e.outcome?.startsWith("already") ? "bg-blue-200 text-blue-900" :
                          e.outcome?.startsWith("rate_limited") ? "bg-orange-200 text-orange-900" :
                          e.outcome === "invalid_email" ? "bg-red-200 text-red-900" :
                          "bg-gray-200 text-gray-700"
                        }`}>
                          {e.outcome}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono text-gray-500">{(e.ip || "").slice(0, 15)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <div className="bg-white border-2 border-black rounded p-2 text-center">
          <div className="text-[10px] uppercase font-bold">Total</div>
          <div className="text-xl font-extrabold">{stats.total}</div>
        </div>
        <div className="bg-blue-100 border-2 border-blue-300 rounded p-2 text-center">
          <div className="text-[10px] uppercase font-bold">En attente</div>
          <div className="text-xl font-extrabold text-blue-900" data-testid="trials-stats-pending">
            {stats.pending}
          </div>
        </div>
        <div className="bg-green-100 border-2 border-green-300 rounded p-2 text-center">
          <div className="text-[10px] uppercase font-bold">Envoyés</div>
          <div className="text-xl font-extrabold text-green-900">{stats.used}</div>
        </div>
        <div className="bg-yellow-100 border-2 border-yellow-300 rounded p-2 text-center">
          <div className="text-[10px] uppercase font-bold">Actifs</div>
          <div className="text-xl font-extrabold text-yellow-900">{stats.active}</div>
        </div>
        <div className="bg-gray-200 border-2 border-gray-400 rounded p-2 text-center">
          <div className="text-[10px] uppercase font-bold">Désactivés</div>
          <div className="text-xl font-extrabold text-gray-700">{stats.disabled}</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Rechercher par email…"
            className="w-full pl-7 pr-3 py-1.5 text-sm bg-white border-2 border-black rounded"
            data-testid="trials-filter-input"
          />
        </div>
        {["all", "pending", "used", "disabled"].map((k) => (
          <Button
            key={k}
            onClick={() => setStatusFilter(k)}
            variant={statusFilter === k ? "default" : "outline"}
            size="sm"
            className={`text-xs ${
              statusFilter === k
                ? "bg-row-pink text-white border-2 border-black"
                : "bg-white border-2 border-black"
            }`}
            data-testid={`trials-filter-${k}`}
          >
            {k === "all" ? "Tous" : k === "pending" ? "En attente" : k === "used" ? "Envoyés" : "Désactivés"}
          </Button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-6">
          {data.items.length === 0
            ? "Aucun trial pour l'instant. Quand un visiteur saisit son email sur la page de login, il apparaîtra ici."
            : "Aucun trial ne correspond aux filtres."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((t) => {
            const StatusIcon = t.status.Icon;
            return (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-2 p-2 bg-white border border-gray-200 rounded text-sm"
                data-testid={`trial-row-${t.id}`}
              >
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded ${t.status.color}`}
                  data-testid={`trial-status-${t.id}`}
                >
                  <StatusIcon className="h-3 w-3" />
                  {t.status.label}
                </span>
                <span className="font-mono font-bold flex-1 min-w-[160px] truncate">
                  {t.email}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    t.source === "admin_manual"
                      ? "bg-amber-100 text-amber-900 border-amber-500"
                      : t.source === "login_page"
                      ? "bg-green-100 text-green-900 border-green-500"
                      : "bg-gray-100 text-gray-700 border-gray-400"
                  }`}
                  title="Source d'inscription"
                  data-testid={`trial-source-${t.id}`}
                >
                  {t.source === "admin_manual"
                    ? "👤 ADMIN"
                    : t.source === "login_page"
                    ? "🎁 FORMULAIRE"
                    : (t.source || "visitor").toUpperCase()}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  envoi : {t.trialDate || "—"}
                </span>
                {t.trialUsedAt && (
                  <span className="text-[11px] text-green-700 font-mono">
                    ✓ {new Date(t.trialUsedAt).toLocaleDateString("fr-FR")}
                  </span>
                )}
                {t.followupSent && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-200 text-purple-900"
                    data-testid={`trial-followup-${t.id}`}
                    title={`Relance envoyée le ${t.followupSentAt ? new Date(t.followupSentAt).toLocaleDateString("fr-FR") : ""}`}
                  >
                    🎯 Relance OK
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground hidden md:inline truncate max-w-[160px]">
                  {t.ip || ""}
                </span>
                <Button
                  onClick={() => handleResend(t)}
                  variant="outline"
                  size="sm"
                  disabled={sendingId === t.id}
                  className="h-7 text-xs bg-blue-100 border-2 border-black hover:bg-blue-200 disabled:opacity-50"
                  title="Renvoyer le digest R1 maintenant"
                  data-testid={`trial-resend-${t.id}`}
                >
                  {sendingId === t.id ? (
                    <RefreshCw className="h-3 w-3 mr-0.5 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3 mr-0.5" />
                  )}
                  {sendingId === t.id ? "Envoi…" : "Renvoyer"}
                </Button>
                <Button
                  onClick={() => handlePromote(t)}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs bg-yellow-100 border-2 border-black hover:bg-yellow-200"
                  title="Convertir en abonné permanent"
                  data-testid={`trial-promote-${t.id}`}
                >
                  <CornerDownRight className="h-3 w-3 mr-0.5" />
                  Promouvoir
                </Button>
                <Switch
                  checked={!!t.active}
                  onCheckedChange={() => handleToggle(t)}
                  aria-label={`Activer ${t.email}`}
                  data-testid={`trial-toggle-${t.id}`}
                />
                <Button
                  onClick={() => handleDelete(t)}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-100"
                  data-testid={`trial-delete-${t.id}`}
                  title="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground italic mt-3">
        💡 <b>Aujourd'hui :</b> {today} · L'envoi quotidien à 08h00 Paris inclut tous les trials avec{" "}
        <code className="bg-muted px-1">trialDate ≤ aujourd'hui</code> et{" "}
        <code className="bg-muted px-1">active=true</code> et <code className="bg-muted px-1">trialUsed=false</code>.
      </p>
    </section>
  );
};

export default TrialsPanel;

