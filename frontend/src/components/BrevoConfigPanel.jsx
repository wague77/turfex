"use client";

/**
 * BrevoConfigPanel — gestion clé Brevo + sender + test + provider switcher.
 *
 * Permet à l'admin :
 *   - de stocker/modifier la clé Brevo en MongoDB (app_secrets.brevo_api_key)
 *   - de basculer entre Resend et Brevo comme provider primaire
 *   - d'activer/désactiver le fallback automatique entre les deux
 *   - de configurer l'expéditeur Brevo (email + nom)
 *   - de voir les crédits restants (300/jour gratuits)
 *   - de tester immédiatement un envoi Brevo
 *   - de lister les senders et domaines vérifiés sur Brevo
 */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Mail,
  Save,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Trash2,
  Zap,
  CreditCard,
} from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

export default function BrevoConfigPanel({ token }) {
  const [keyStatus, setKeyStatus] = useState(null);
  const [providerCfg, setProviderCfg] = useState(null);
  const [account, setAccount] = useState(null);
  const [senders, setSenders] = useState([]);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);

  const [senderEmailDraft, setSenderEmailDraft] = useState("");
  const [senderNameDraft, setSenderNameDraft] = useState("");
  const [savingSender, setSavingSender] = useState(false);

  const [savingProvider, setSavingProvider] = useState(false);

  const headers = { headers: { "X-Admin-Password": token } };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keyRes, provRes] = await Promise.all([
        axios.get(`${API}/admin/secrets/brevo-api-key`, headers),
        axios.get(`${API}/admin/email-provider`, headers),
      ]);
      setKeyStatus(keyRes.data);
      setProviderCfg(provRes.data);
      setSenderEmailDraft(provRes.data?.brevo_sender_email || "");
      setSenderNameDraft(provRes.data?.brevo_sender_name || "");

      // Load account/senders/domains seulement si clé active
      if (keyRes.data?.activeSource !== "none") {
        try {
          const [accRes, sendRes, domRes] = await Promise.all([
            axios.get(`${API}/admin/brevo/account`, headers),
            axios.get(`${API}/admin/brevo/senders`, headers),
            axios.get(`${API}/admin/brevo/domains`, headers),
          ]);
          setAccount(accRes.data?.account);
          setSenders(sendRes.data?.senders || []);
          setDomains(domRes.data?.domains || []);
        } catch (_) {
          // Ignore : la clé peut être invalide, on affiche juste le statut
        }
      }
    } catch (err) {
      toast.error("Erreur chargement Brevo", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const handleSaveKey = async () => {
    if (!newKey.trim()) {
      toast.error("Clé vide");
      return;
    }
    if (!newKey.trim().startsWith("xkeysib-")) {
      toast.error("Format invalide", { description: "La clé doit commencer par 'xkeysib-'" });
      return;
    }
    if (!window.confirm("Enregistrer cette nouvelle clé Brevo ? Elle sera utilisée immédiatement.")) return;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/admin/secrets/brevo-api-key`, { apiKey: newKey.trim() }, headers);
      toast.success("Clé Brevo enregistrée", { description: data.activeKeyMasked });
      setNewKey("");
      await load();
    } catch (err) {
      toast.error("Erreur sauvegarde", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!window.confirm("Retirer la clé Brevo de MongoDB et retomber sur la valeur .env ?")) return;
    setSaving(true);
    try {
      await axios.post(`${API}/admin/secrets/brevo-api-key`, { apiKey: "" }, headers);
      toast.success("Override Brevo retiré");
      await load();
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.includes("@")) {
      toast.error("Email invalide");
      return;
    }
    setTesting(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/secrets/brevo-api-key/test`,
        { email: testEmail.trim() },
        headers
      );
      if (data.ok) {
        toast.success(`Email Brevo envoyé à ${data.email}`, {
          description: `ID : ${(data.id || "").slice(0, 30)}…`,
          duration: 8000,
        });
      } else {
        toast.error("Test Brevo échoué", { description: data.error || "Erreur inconnue", duration: 12000 });
      }
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSender = async () => {
    const em = (senderEmailDraft || "").trim();
    if (em && !em.includes("@")) {
      toast.error("Email expéditeur invalide");
      return;
    }
    setSavingSender(true);
    try {
      const { data } = await axios.patch(
        `${API}/admin/email-provider`,
        {
          brevo_sender_email: em,
          brevo_sender_name: (senderNameDraft || "").trim(),
        },
        headers
      );
      setProviderCfg(data);
      toast.success("Expéditeur Brevo mis à jour");
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingSender(false);
    }
  };

  const handleSwitchProvider = async (provider) => {
    setSavingProvider(true);
    try {
      const { data } = await axios.patch(
        `${API}/admin/email-provider`,
        { email_provider: provider },
        headers
      );
      setProviderCfg(data);
      toast.success(`Provider primaire : ${provider.toUpperCase()}`);
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingProvider(false);
    }
  };

  const handleToggleFallback = async (enabled) => {
    setSavingProvider(true);
    try {
      const { data } = await axios.patch(
        `${API}/admin/email-provider`,
        { email_fallback_enabled: enabled },
        headers
      );
      setProviderCfg(data);
      toast.success(`Fallback automatique ${enabled ? "ACTIVÉ" : "DÉSACTIVÉ"}`);
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSavingProvider(false);
    }
  };

  if (loading) {
    return (
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <div className="text-sm text-gray-600">Chargement Brevo…</div>
      </section>
    );
  }

  const hasKey = keyStatus?.activeSource && keyStatus.activeSource !== "none";
  const sourceColor = hasKey ? (keyStatus.activeSource === "db" ? "violet" : "emerald") : "red";
  const credits = account?.plan?.[0]?.credits;

  const primaryProvider = providerCfg?.email_provider || "resend";
  const fallbackEnabled = !!providerCfg?.email_fallback_enabled;

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="brevo-config-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <Mail className="h-5 w-5 text-cyan-600" />
        <h2 className="text-lg font-bold">Configuration Brevo (alternatif à Resend)</h2>
      </div>

      {/* Provider switcher : resend vs brevo + fallback */}
      <div className="bg-gradient-to-r from-violet-50 to-cyan-50 border-2 border-black rounded p-3 mb-4" data-testid="email-provider-switcher">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4" />
          <div className="font-bold text-sm">Provider primaire pour TOUS les envois</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button
            onClick={() => handleSwitchProvider("resend")}
            disabled={savingProvider || primaryProvider === "resend"}
            size="sm"
            className={`border-2 border-black font-bold ${primaryProvider === "resend" ? "bg-pink-500 text-white" : "bg-white text-black hover:bg-pink-100"}`}
            data-testid="email-provider-switch-resend"
          >
            {primaryProvider === "resend" && <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Resend
          </Button>
          <Button
            onClick={() => handleSwitchProvider("brevo")}
            disabled={savingProvider || primaryProvider === "brevo"}
            size="sm"
            className={`border-2 border-black font-bold ${primaryProvider === "brevo" ? "bg-cyan-500 text-white" : "bg-white text-black hover:bg-cyan-100"}`}
            data-testid="email-provider-switch-brevo"
          >
            {primaryProvider === "brevo" && <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Brevo
          </Button>
          <span className="text-xs text-gray-600 ml-2">
            Actuel : <span className="font-bold uppercase">{primaryProvider}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-gray-300">
          <Switch
            checked={fallbackEnabled}
            onCheckedChange={handleToggleFallback}
            disabled={savingProvider}
            data-testid="email-provider-fallback-toggle"
            aria-label="Fallback automatique"
          />
          <div className="flex-1">
            <div className="text-xs font-bold">
              Fallback automatique{" "}
              <span className={fallbackEnabled ? "text-emerald-700" : "text-gray-500"}>
                {fallbackEnabled ? "ACTIVÉ" : "DÉSACTIVÉ"}
              </span>
            </div>
            <div className="text-[11px] text-gray-600">
              Si {primaryProvider === "resend" ? "Resend" : "Brevo"} échoue (quota, panne, clé invalide), bascule
              automatiquement sur {primaryProvider === "resend" ? "Brevo" : "Resend"}.
            </div>
          </div>
        </div>
      </div>

      {/* Statut clé Brevo */}
      <div
        className={`border-2 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3 ${
          sourceColor === "red"
            ? "border-red-500 bg-red-50"
            : sourceColor === "violet"
            ? "border-violet-500 bg-violet-50"
            : "border-emerald-500 bg-emerald-50"
        }`}
        data-testid="brevo-key-status"
      >
        {sourceColor === "red" ? (
          <AlertTriangle className="h-5 w-5 text-red-600" />
        ) : (
          <CheckCircle2 className={`h-5 w-5 text-${sourceColor}-600`} />
        )}
        <div className="flex-1 min-w-[200px]">
          <div className="font-bold text-sm">
            Clé Brevo : {hasKey ? (
              <span className="font-mono">{keyStatus.activeKeyMasked}</span>
            ) : (
              <span className="text-red-700">absente</span>
            )}
          </div>
          {keyStatus.dbKeyUpdatedAt && (
            <div className="text-[11px] text-gray-600 mt-0.5">
              MAJ : {new Date(keyStatus.dbKeyUpdatedAt).toLocaleString("fr-FR")} (source : {keyStatus.activeSource})
            </div>
          )}
        </div>
        {credits != null && (
          <div className="flex items-center gap-1 px-2 py-1 bg-white border-2 border-emerald-500 rounded text-xs font-bold" data-testid="brevo-credits-badge">
            <CreditCard className="h-3 w-3 text-emerald-600" />
            {credits} crédits
          </div>
        )}
        {account?.email && (
          <div className="text-[11px] text-gray-600">Compte : <span className="font-mono">{account.email}</span></div>
        )}
        {keyStatus.dbKeyPresent && (
          <Button
            onClick={handleRemoveKey}
            disabled={saving}
            size="sm"
            variant="outline"
            className="bg-white border-red-500 text-red-700 hover:bg-red-50"
            data-testid="brevo-key-remove-btn"
          >
            <Trash2 className="h-3 w-3 mr-1" /> Retirer
          </Button>
        )}
      </div>

      {/* Mise à jour clé */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-3">
        <Label className="block text-sm font-bold mb-2">Nouvelle clé API Brevo</Label>
        <div className="flex gap-2 items-center">
          <Input
            type={showKey ? "text" : "password"}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="xkeysib-..."
            className="flex-1 font-mono text-xs"
            data-testid="brevo-key-input"
          />
          <Button onClick={() => setShowKey((v) => !v)} size="sm" variant="outline" className="bg-white">
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            onClick={handleSaveKey}
            disabled={saving || !newKey.trim()}
            size="sm"
            className="bg-gradient-to-r from-violet-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
            data-testid="brevo-key-save-btn"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Sauvegarder
          </Button>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Récupère ta clé sur{" "}
          <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">
            app.brevo.com/settings/keys/api
          </a>{" "}
          — elle commence par <code className="bg-gray-100 px-1 rounded">xkeysib-</code>.
        </div>
      </div>

      {/* Config expéditeur Brevo */}
      {hasKey && (
        <div className="bg-white border border-gray-300 rounded p-3 mb-3">
          <Label className="block text-sm font-bold mb-2">Expéditeur Brevo (doit utiliser un domaine vérifié)</Label>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              type="email"
              value={senderEmailDraft}
              onChange={(e) => setSenderEmailDraft(e.target.value)}
              placeholder="noreply@turfex.fr"
              className="flex-1 min-w-[220px] font-mono text-xs"
              data-testid="brevo-sender-email-input"
            />
            <Input
              type="text"
              value={senderNameDraft}
              onChange={(e) => setSenderNameDraft(e.target.value)}
              placeholder="TURFEX"
              className="w-32 text-xs"
              data-testid="brevo-sender-name-input"
            />
            <Button
              onClick={handleSaveSender}
              disabled={savingSender}
              size="sm"
              className="bg-yellow-100 border-2 border-black hover:bg-yellow-200 text-black font-bold"
              data-testid="brevo-sender-save-btn"
            >
              OK
            </Button>
          </div>
          {domains.length > 0 && (
            <div className="text-[11px] text-gray-600 mt-2">
              Domaines vérifiés Brevo :{" "}
              {domains.map((d) => (
                <span
                  key={d.id || d.domain_name}
                  className={`inline-block mr-2 px-1.5 py-0.5 font-mono ${
                    d.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  } rounded`}
                >
                  {d.domain_name} {d.verified ? "✓" : "⏳"}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Test envoi */}
      {hasKey && (
        <div className="bg-white border border-gray-300 rounded p-3">
          <Label className="block text-sm font-bold mb-2">Tester un envoi via Brevo</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="ton-email@example.com"
              className="flex-1"
              data-testid="brevo-test-email-input"
            />
            <Button
              onClick={handleTest}
              disabled={testing || !testEmail.trim()}
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
              data-testid="brevo-test-btn"
            >
              {testing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Tester Brevo
            </Button>
          </div>
          {senders.length > 0 && (
            <div className="text-[11px] text-gray-500 mt-2">
              Senders Brevo : {senders.map((s) => s.email).join(", ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

