"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Users,
  Mail,
  UserPlus,
  Trash2,
  RefreshCw,
  Ticket,
  Edit3,
  Download,
} from "lucide-react";
import LiveSendStatus from "@/components/LiveSendStatus";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

export const SubscribersPanel = ({ token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);

  const [exporting, setExporting] = useState(false);

  const EXPORT_CONFIGS = {
    r1: {
      path: "/admin/notifications/digest/r1-pronostics/export",
      filenamePrefix: "turfex-r1",
      label: "R1",
    },
    "ferran-r1": {
      path: "/admin/notifications/digest/ferran-r1/export",
      filenamePrefix: "turfex-ferran-r1",
      label: "Couplés Ferran R1",
    },
  };

  const downloadExport = async (kind = "r1", light = false) => {
    setExporting(true);
    try {
      const cfg = EXPORT_CONFIGS[kind];
      const url = `${API}${cfg.path}${light ? "?light=1" : ""}`;
      const resp = await axios.get(url, {
        headers: { "X-Admin-Password": token },
        responseType: "blob",
        timeout: 120000, // ferran-r1 peut prendre ~30-60s (analyse de toutes les courses)
      });
      // Récupère le filename depuis Content-Disposition
      const cd = resp.headers["content-disposition"] || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename =
        match
          ? match[1]
          : `${cfg.filenamePrefix}-${new Date().toISOString().slice(0, 10)}${light ? "-gmail" : ""}.html`;

      const blob = new Blob([resp.data], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success(
        `Export ${cfg.label}${light ? " (Gmail)" : ""} téléchargé`,
        { description: filename }
      );
    } catch (err) {
      let detail = err?.message;
      try {
        // Si la réponse est une erreur, axios renvoie un Blob → on la lit
        if (err?.response?.data instanceof Blob) {
          const txt = await err.response.data.text();
          try {
            detail = JSON.parse(txt).detail || txt;
          } catch {
            detail = txt;
          }
        } else if (err?.response?.data?.detail) {
          detail = err.response.data.detail;
        }
      } catch {}
      toast.error("Export impossible", { description: detail });
    } finally {
      setExporting(false);
    }
  };

  const handleExportR1 = () => downloadExport("r1", false);
  const handleExportR1Gmail = () => downloadExport("r1", true);
  const handleExportFerranR1 = () => downloadExport("ferran-r1", false);
  const handleExportFerranR1Gmail = () => downloadExport("ferran-r1", true);

  const authHeaders = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/admin/subscribers`, authHeaders);
      setData(resp.data || { manual: [], fromCodes: [], activeRecipients: [] });
    } catch (err) {
      toast.error("Erreur chargement abonnés", {
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

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setCreating(true);
    try {
      await axios.post(
        `${API}/admin/subscribers`,
        { email: newEmail.trim(), note: newNote.trim() },
        authHeaders
      );
      toast.success("Abonné ajouté");
      setNewEmail("");
      setNewNote("");
      await load();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Erreur";
      toast.error(typeof msg === "string" ? msg : "Erreur ajout");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (sub) => {
    try {
      await axios.patch(
        `${API}/admin/subscribers/${sub.id}`,
        { active: !sub.active },
        authHeaders
      );
      await load();
    } catch (_) {
      toast.error("Erreur");
    }
  };

  const handleDelete = async (sub) => {
    if (!window.confirm(`Supprimer ${sub.email} ?`)) return;
    try {
      await axios.delete(`${API}/admin/subscribers/${sub.id}`, authHeaders);
      toast.success("Supprimé");
      await load();
    } catch (_) {
      toast.error("Erreur");
    }
  };

  if (!data) {
    return (
      <section
        className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-3 mb-6 text-xs italic text-muted-foreground"
        data-testid="subscribers-panel-loading"
      >
        Chargement abonnés…
      </section>
    );
  }

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="subscribers-panel"
    >
      <LiveSendStatus token={token} />
      <div className="flex items-center gap-3 mb-3">
        <Users className="h-5 w-5 text-row-pink" />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-base flex items-center gap-2 flex-wrap">
            Abonnés email (pronostics R1 quotidiens)
            <span
              className="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-green-200 text-green-900"
              data-testid="subscribers-active-count"
            >
              {data.activeCount || 0} actif{(data.activeCount || 0) > 1 ? "s" : ""}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Reçoivent chaque jour à 08h00 (Paris) le top 8 par course de R1 avec explications.
          </p>
        </div>
        <Button
          onClick={handleExportR1}
          disabled={exporting}
          size="sm"
          className="bg-gradient-to-r from-pink-500 to-violet-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
          data-testid="subscribers-export-r1-btn"
          title="Télécharger le digest R1 du jour en .html (sans envoyer d'email)"
        >
          {exporting ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          {exporting ? "Génération…" : "Exporter R1 (.html)"}
        </Button>
        <Button
          onClick={handleExportR1Gmail}
          disabled={exporting}
          size="sm"
          variant="outline"
          className="bg-white border-2 border-black hover:bg-yellow-50 disabled:opacity-50 font-bold"
          data-testid="subscribers-export-r1-gmail-btn"
          title="Version compacte (~70 KB) sans image de fond — compatible Gmail (pas de troncature)"
        >
          {exporting ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          Version Gmail
        </Button>
        <Button
          onClick={handleExportFerranR1}
          disabled={exporting}
          size="sm"
          className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
          data-testid="subscribers-export-ferran-r1-btn"
          title="Couplés & Tiercés Ferran pour toutes les courses R1 du jour (sans envoyer d'email)"
        >
          {exporting ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          Couplés Ferran R1 (.html)
        </Button>
        <Button
          onClick={handleExportFerranR1Gmail}
          disabled={exporting}
          size="sm"
          variant="outline"
          className="bg-white border-2 border-black hover:bg-emerald-50 disabled:opacity-50 font-bold"
          data-testid="subscribers-export-ferran-r1-gmail-btn"
          title="Version compacte (~45 KB) sans image de fond — compatible Gmail"
        >
          {exporting ? (
            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1" />
          )}
          Ferran Gmail
        </Button>
        <Button
          onClick={load}
          variant="outline"
          size="sm"
          className="bg-white border-2 border-black"
          disabled={loading}
          data-testid="subscribers-refresh-btn"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Formulaire ajout */}
      <form
        onSubmit={handleAdd}
        className="flex flex-col md:flex-row gap-2 mb-4 p-3 bg-yellow-50 border-2 border-yellow-200 rounded"
        data-testid="subscriber-add-form"
      >
        <div className="flex-1 min-w-0">
          <Label className="text-xs font-bold flex items-center gap-1">
            <Mail className="h-3 w-3" /> Email
          </Label>
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="client@exemple.com"
            required
            className="bg-white"
            data-testid="subscriber-email-input"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Label className="text-xs font-bold flex items-center gap-1">
            <Edit3 className="h-3 w-3" /> Note (optionnel)
          </Label>
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Ex: Ami, client VIP, test"
            className="bg-white"
            data-testid="subscriber-note-input"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={creating || !newEmail.trim()}
            className="bg-caf-green hover:bg-caf-green/90 text-caf-green-foreground font-bold"
            data-testid="subscriber-add-btn"
          >
            <UserPlus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </div>
      </form>

      {/* Liste abonnés manuels */}
      {data.manual?.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-bold uppercase mb-2 text-muted-foreground">
            Abonnés ajoutés manuellement ({data.manual.length})
          </div>
          <div className="space-y-1">
            {data.manual.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded text-sm"
                data-testid={`subscriber-row-${s.id}`}
              >
                <Mail className="h-3.5 w-3.5 text-row-pink shrink-0" />
                <span className="font-mono font-bold flex-1 truncate">{s.email}</span>
                {s.note && (
                  <span className="text-[11px] text-muted-foreground italic truncate max-w-[200px]">
                    {s.note}
                  </span>
                )}
                <Switch
                  checked={!!s.active}
                  onCheckedChange={() => handleToggle(s)}
                  aria-label={`Activer ${s.email}`}
                  data-testid={`subscriber-toggle-${s.id}`}
                />
                <Button
                  onClick={() => handleDelete(s)}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-100"
                  data-testid={`subscriber-delete-${s.id}`}
                  title="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Emails liés à des codes */}
      {data.fromCodes?.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase mb-2 text-muted-foreground flex items-center gap-1">
            <Ticket className="h-3 w-3" /> Emails liés à des codes d'accès ({data.fromCodes.length})
          </div>
          <div className="space-y-1">
            {data.fromCodes.slice(0, 20).map((c, i) => {
              const isExpired = c.expiresAt && new Date(c.expiresAt) < new Date();
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2 bg-white border border-gray-200 rounded text-xs ${
                    isExpired || !c.active ? "opacity-50" : ""
                  }`}
                >
                  <Ticket className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-mono font-bold">{c.email}</span>
                  <span className="text-muted-foreground">→ code</span>
                  <span className="font-mono text-[10px] bg-yellow-100 px-1.5 py-0.5 rounded">
                    {c.code}
                  </span>
                  {c.label && (
                    <span className="text-muted-foreground italic truncate max-w-[150px]">
                      {c.label}
                    </span>
                  )}
                  {isExpired && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-200 text-red-800">
                      expiré
                    </span>
                  )}
                  {!c.active && !isExpired && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-800">
                      désactivé
                    </span>
                  )}
                </div>
              );
            })}
            {data.fromCodes.length > 20 && (
              <p className="text-[11px] text-muted-foreground italic">
                … +{data.fromCodes.length - 20} de plus (édite les codes depuis la table pour gérer l'email)
              </p>
            )}
          </div>
        </div>
      )}

      {data.manual?.length === 0 && data.fromCodes?.length === 0 && (
        <p className="text-sm text-muted-foreground italic text-center py-6">
          Aucun abonné. Ajoute ton premier email ci-dessus, ou attribue un email à un code existant.
        </p>
      )}
    </section>
  );
};

export default SubscribersPanel;

