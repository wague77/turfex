"use client";

/**
 * ResendConfigPanel — admin UI pour modifier la clé API Resend sans redéploiement.
 *
 * Stocke la nouvelle clé en MongoDB (collection app_secrets) qui prime sur le `.env`.
 * Inclut un bouton "Tester l'envoi" pour valider la nouvelle clé immédiatement.
 *
 * Sécurité : la clé n'est jamais affichée en clair (masquage `re_xxxx***xxxx`).
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Key, Save, Send, RefreshCw, AlertTriangle, CheckCircle2, Trash2, Eye, EyeOff } from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

export default function ResendConfigPanel({ token }) {
  const [status, setStatus] = useState(null);
  const [senderStatus, setSenderStatus] = useState(null);
  const [senderDraft, setSenderDraft] = useState("");
  const [savingSender, setSavingSender] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);

  const headers = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    setLoading(true);
    try {
      const [keyRes, senderRes] = await Promise.all([
        axios.get(`${API}/admin/secrets/resend-api-key`, headers),
        axios.get(`${API}/admin/secrets/resend-sender-email`, headers),
      ]);
      setStatus(keyRes.data);
      setSenderStatus(senderRes.data);
      setSenderDraft(senderRes.data?.activeValue || "");
    } catch (err) {
      toast.error("Erreur chargement statut Resend", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSaveSender = async () => {
    const val = (senderDraft || "").trim();
    if (val && (!val.includes("@") || !val.split("@")[1]?.includes("."))) {
      toast.error("Email invalide");
      return;
    }
    setSavingSender(true);
    try {
      await axios.post(`${API}/admin/secrets/resend-sender-email`, { senderEmail: val }, headers);
      toast.success(val ? `Expéditeur Resend : ${val}` : "Override DB retiré");
      await load();
    } catch (err) {
      toast.error("Erreur sauvegarde", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSavingSender(false);
    }
  };

  const handleSave = async () => {
    if (!newKey.trim()) {
      toast.error("Clé vide", { description: "Entre une clé Resend valide." });
      return;
    }
    if (!newKey.trim().startsWith("re_")) {
      toast.error("Format invalide", { description: "La clé doit commencer par 're_'." });
      return;
    }
    if (!window.confirm(
      "Confirmer la mise à jour de la clé Resend ?\n\n" +
      "La nouvelle clé sera stockée en MongoDB et utilisée immédiatement " +
      "pour tous les envois (sans redéploiement nécessaire)."
    )) return;
    setSaving(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/secrets/resend-api-key`,
        { apiKey: newKey.trim() },
        headers
      );
      toast.success("Clé Resend mise à jour", {
        description: `Source active : ${data.activeSource} · ${data.activeKeyMasked}`,
      });
      setNewKey("");
      await load();
    } catch (err) {
      toast.error("Mise à jour échouée", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOverride = async () => {
    if (!window.confirm(
      "Supprimer l'override MongoDB et retomber sur la clé du fichier .env ?"
    )) return;
    setSaving(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/secrets/resend-api-key`,
        { apiKey: "" },
        headers
      );
      toast.success("Override retiré", {
        description: data.message,
      });
      await load();
    } catch (err) {
      toast.error("Erreur", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const em = testEmail.trim();
    if (!em || !em.includes("@")) {
      toast.error("Email invalide");
      return;
    }
    setTesting(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/secrets/resend-api-key/test`,
        { email: em },
        headers
      );
      if (data.ok) {
        toast.success(`Email de test envoyé à ${em}`, {
          description: `Resend ID : ${data.id?.slice(0, 8)}…`,
          duration: 8000,
        });
      } else {
        toast.error("Test échoué", {
          description: data.error || "Erreur inconnue",
          duration: 12000,
        });
      }
    } catch (err) {
      toast.error("Test échoué", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <div className="text-sm text-gray-600">Chargement config Resend…</div>
      </section>
    );
  }

  if (!status) return null;

  const sourceColor = status.activeSource === "db" ? "violet" : status.activeSource === "env" ? "emerald" : "red";
  const sourceLabels = {
    db: "MongoDB (override)",
    env: "Fichier .env",
    none: "AUCUNE — envois désactivés",
  };

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="resend-config-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <Key className="h-5 w-5" />
        <h2 className="text-lg font-bold">Configuration Resend (API Key)</h2>
      </div>

      {/* Statut actuel */}
      <div
        className={`border-2 rounded-lg p-3 mb-4 flex items-center gap-3 ${
          sourceColor === "red"
            ? "border-red-500 bg-red-50"
            : sourceColor === "violet"
            ? "border-violet-500 bg-violet-50"
            : "border-emerald-500 bg-emerald-50"
        }`}
        data-testid="resend-config-status"
      >
        {sourceColor === "red" ? (
          <AlertTriangle className="h-5 w-5 text-red-600" />
        ) : (
          <CheckCircle2 className={`h-5 w-5 text-${sourceColor}-600`} />
        )}
        <div className="flex-1">
          <div className="font-bold text-sm">
            Source active : <span className={`text-${sourceColor}-700`}>{sourceLabels[status.activeSource]}</span>
          </div>
          <div className="text-xs text-gray-600 font-mono mt-0.5">
            Clé : <span className="font-bold">{status.activeKeyMasked || "(absente)"}</span>
            {status.dbKeyUpdatedAt && (
              <span className="ml-2 text-gray-500">
                · MongoDB MAJ {new Date(status.dbKeyUpdatedAt).toLocaleString("fr-FR")}
              </span>
            )}
          </div>
        </div>
        {status.dbKeyPresent && (
          <Button
            onClick={handleRemoveOverride}
            disabled={saving}
            size="sm"
            variant="outline"
            className="bg-white border-red-500 text-red-700 hover:bg-red-50"
            data-testid="resend-config-remove-override-btn"
            title="Retirer l'override MongoDB et retomber sur la clé .env"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Retirer override
          </Button>
        )}
      </div>

      <div className="text-xs text-gray-600 mb-3">{status.hint}</div>

      {/* Formulaire mise à jour */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-3">
        <label className="block text-sm font-bold mb-2">Nouvelle clé Resend</label>
        <div className="flex gap-2 items-center">
          <Input
            type={showKey ? "text" : "password"}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="re_xxxxxxxx..."
            className="flex-1 font-mono"
            data-testid="resend-config-new-key-input"
          />
          <Button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            size="sm"
            variant="outline"
            className="bg-white"
            title={showKey ? "Masquer" : "Afficher"}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !newKey.trim()}
            size="sm"
            className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
            data-testid="resend-config-save-btn"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Sauvegarder
          </Button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Récupère ta clé sur{" "}
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-700 underline"
          >
            resend.com/api-keys
          </a>
          {" "}— elle commence par <code className="bg-gray-100 px-1 rounded">re_</code>.
        </div>
      </div>

      {/* Expéditeur Resend (SENDER_EMAIL) */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-3" data-testid="resend-sender-section">
        <label className="block text-sm font-bold mb-2">
          Expéditeur Resend (doit utiliser un domaine vérifié sur Resend)
        </label>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            type="email"
            value={senderDraft}
            onChange={(e) => setSenderDraft(e.target.value)}
            placeholder="noreply@turfex.fr"
            className="flex-1 min-w-[220px] font-mono text-xs"
            data-testid="resend-sender-input"
          />
          <Button
            onClick={handleSaveSender}
            disabled={savingSender}
            size="sm"
            className="bg-yellow-100 border-2 border-black hover:bg-yellow-200 text-black font-bold"
            data-testid="resend-sender-save-btn"
          >
            {savingSender ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            OK
          </Button>
        </div>
        {senderStatus && (
          <div className="text-[11px] text-gray-600 mt-2 flex items-center gap-2">
            <span>
              Actif : <span className="font-mono font-bold">{senderStatus.activeValue}</span>{" "}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                senderStatus.activeSource === "db" ? "bg-violet-100 text-violet-800" : "bg-gray-200 text-gray-700"
              }`}>
                source : {senderStatus.activeSource.toUpperCase()}
              </span>
            </span>
            {senderStatus.dbValueUpdatedAt && (
              <span className="text-gray-500">
                · MAJ {new Date(senderStatus.dbValueUpdatedAt).toLocaleString("fr-FR")}
              </span>
            )}
          </div>
        )}
        <div className="text-[11px] text-gray-500 mt-1 italic">
          ⚠ Le domaine de cet email doit être <b>vérifié</b> sur le compte Resend (voir panel "Domaines vérifiés Resend"). Sinon Resend rejettera tous les envois.
        </div>
      </div>

      {/* Test envoi */}
      <div className="bg-white border border-gray-300 rounded p-3">
        <label className="block text-sm font-bold mb-2">Tester un envoi</label>
        <div className="flex gap-2 items-center">
          <Input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="ton-email@example.com"
            className="flex-1"
            data-testid="resend-config-test-email-input"
          />
          <Button
            onClick={handleTest}
            disabled={testing || !testEmail.trim()}
            size="sm"
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
            data-testid="resend-config-test-btn"
          >
            {testing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Envoyer test
          </Button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Envoie un email de validation avec la clé active. Si tu reçois l'email, tout fonctionne.
        </div>
      </div>
    </section>
  );
}

