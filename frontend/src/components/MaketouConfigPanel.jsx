"use client";

/**
 * MaketouConfigPanel — admin UI pour configurer la passerelle de paiement Maketou.
 *
 * - Toggles pour afficher Chariow / Maketou (1 ou 2 actifs sur la page de login).
 * - Saisie de la clé API Maketou (masquée) + 3 productDocumentId (1m, 3m, 1y).
 * - Bouton "Tester" : crée un panier de test avec l'email saisi et ouvre le checkout
 *   dans un nouvel onglet pour validation manuelle.
 *
 * Stockage : MongoDB collection `app_secrets` (`maketou_api_key`, `maketou_product_{1m,3m,1y}`)
 *            + setting `payment_providers` dans `notification_settings`.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CreditCard, Save, Send, RefreshCw, Eye, EyeOff, ExternalLink, CheckCircle2, XCircle } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const PLAN_LABELS = {
  "1m": { label: "1 mois", price: "30 €", optionLabel: "1 mois · 30 €" },
  "3m": { label: "3 mois", price: "80 € (au lieu de 90 €)", optionLabel: "3 mois · 80 € (au lieu de 90 €)" },
  "1y": { label: "1 an", price: "260 € (au lieu de 360 €)", optionLabel: "1 an · 260 € (au lieu de 360 €)" },
};

export default function MaketouConfigPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chariowEnabled, setChariowEnabled] = useState(false);
  const [maketouEnabled, setMaketouEnabled] = useState(true);

  const [newApiKey, setNewApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [products, setProducts] = useState({ "1m": "", "3m": "", "1y": "" });

  const [testEmail, setTestEmail] = useState("");
  const [testPlan, setTestPlan] = useState("1m");
  const [testing, setTesting] = useState(false);

  const headers = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/payment/providers`, headers);
      setData(data);
      const provs = data?.providers || [];
      setChariowEnabled(provs.includes("chariow"));
      setMaketouEnabled(provs.includes("maketou"));
    } catch (err) {
      toast.error("Erreur chargement config Maketou", {
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

  const saveProviders = async (next) => {
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/payment/providers`, { providers: next }, headers);
      toast.success(`Affichage : ${next.join(" + ")}`);
      await load();
    } catch (err) {
      toast.error("Erreur sauvegarde", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (provider, checked) => {
    const next = new Set(data?.providers || []);
    if (checked) {
      next.add(provider);
    } else {
      next.delete(provider);
    }
    if (next.size === 0) {
      toast.error("Au moins un provider doit rester actif");
      return;
    }
    await saveProviders(Array.from(next));
  };

  const saveSecrets = async () => {
    const payload = {};
    if (newApiKey.trim()) payload.apiKey = newApiKey.trim();
    if (products["1m"].trim()) payload.product1m = products["1m"].trim();
    if (products["3m"].trim()) payload.product3m = products["3m"].trim();
    if (products["1y"].trim()) payload.product1y = products["1y"].trim();
    if (Object.keys(payload).length === 0) {
      toast.error("Aucune valeur à enregistrer");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/admin/payment/maketou/secrets`, payload, headers);
      toast.success("Configuration Maketou mise à jour");
      setNewApiKey("");
      setProducts({ "1m": "", "3m": "", "1y": "" });
      await load();
    } catch (err) {
      toast.error("Erreur sauvegarde", {
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
        `${API}/admin/payment/maketou/test`,
        { plan: testPlan, email: em, firstName: "Admin", lastName: "Test" },
        headers
      );
      if (data?.ok && data?.redirectUrl) {
        toast.success(`Panier ${data.plan} créé · ${data.price} €`, {
          description: `Cart ID : ${data.cartId?.slice(0, 8)}…`,
          duration: 6000,
        });
        // Ouvre le checkout dans un nouvel onglet
        window.open(data.redirectUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Test échoué", {
          description: data?.error || "Vérifie clé API + productDocumentId",
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
        <div className="text-sm text-gray-600">Chargement config Maketou…</div>
      </section>
    );
  }

  if (!data) return null;

  const m = data.maketou || {};
  const apiOk = !!m.apiKeyConfigured;

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="maketou-config-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="h-5 w-5" />
        <h2 className="text-lg font-bold">Passerelle de paiement Maketou</h2>
      </div>

      {/* Toggles providers */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-4">
        <div className="text-sm font-bold mb-3">Affichage sur la page de login</div>
        <div className="flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 rounded px-3 py-2 mb-2">
          <div>
            <div className="text-sm font-bold text-amber-900">Maketou (3 plans : 1m, 3m, 1y)</div>
            <div className="text-[11px] text-gray-600">
              30 € / 80 € / 260 €
            </div>
          </div>
          <Switch
            checked={maketouEnabled}
            onCheckedChange={(c) => toggleProvider("maketou", c)}
            disabled={saving}
            data-testid="toggle-maketou"
          />
        </div>
        <div className="flex items-center justify-between bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-300 rounded px-3 py-2">
          <div>
            <div className="text-sm font-bold text-yellow-900">Chariow (legacy, plan unique 30 €)</div>
            <div className="text-[11px] text-gray-600">Widget intégré historique</div>
          </div>
          <Switch
            checked={chariowEnabled}
            onCheckedChange={(c) => toggleProvider("chariow", c)}
            disabled={saving}
            data-testid="toggle-chariow"
          />
        </div>
      </div>

      {/* Statut clé Maketou */}
      <div
        className={`border-2 rounded-lg p-3 mb-4 flex items-center gap-3 ${
          apiOk ? "border-emerald-500 bg-emerald-50" : "border-red-500 bg-red-50"
        }`}
        data-testid="maketou-api-status"
      >
        {apiOk ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <XCircle className="h-5 w-5 text-red-600" />
        )}
        <div className="flex-1">
          <div className="font-bold text-sm">
            Clé API : {apiOk ? <span className="text-emerald-700">Configurée</span> : <span className="text-red-700">Absente</span>}
          </div>
          {m.apiKeyMasked && (
            <div className="text-[11px] font-mono text-gray-600 mt-0.5">{m.apiKeyMasked}</div>
          )}
          <div className="grid grid-cols-3 gap-2 mt-2">
            {Object.entries(m.products || {}).map(([k, v]) => (
              <div
                key={k}
                className={`border rounded px-2 py-1 text-[10px] font-mono ${
                  v.set ? "border-emerald-400 bg-white" : "border-red-400 bg-red-50 text-red-800"
                }`}
              >
                <span className="font-bold uppercase">{k}</span>: {v.id || "absent"}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Édition des secrets */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-3 space-y-3" data-testid="maketou-secrets-form">
        <div className="text-sm font-bold">Modifier la configuration</div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-600 mb-1">
            Clé API Maketou (laisser vide pour ne pas changer)
          </label>
          <div className="flex gap-2 items-center">
            <Input
              type={showApiKey ? "text" : "password"}
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="msk_..."
              className="flex-1 font-mono"
              data-testid="maketou-api-key-input"
            />
            <Button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              size="sm"
              variant="outline"
              className="bg-white"
            >
              {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {Object.keys(PLAN_LABELS).map((k) => (
          <div key={k}>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-600 mb-1">
              productDocumentId · {PLAN_LABELS[k].label} · {PLAN_LABELS[k].price}
            </label>
            <Input
              type="text"
              value={products[k]}
              onChange={(e) => setProducts((p) => ({ ...p, [k]: e.target.value }))}
              placeholder="UUID Maketou (ex: 935a6392-2f97-...)"
              className="font-mono text-xs"
              data-testid={`maketou-product-${k}-input`}
            />
          </div>
        ))}

        <Button
          onClick={saveSecrets}
          disabled={saving}
          className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
          data-testid="maketou-save-btn"
        >
          {saving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Sauvegarder
        </Button>

        <div className="text-[11px] text-gray-500 italic flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          <a
            href="https://docs-api.maketou.com/docs/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-700"
          >
            Documentation Maketou
          </a>
        </div>
      </div>

      {/* Test panier */}
      <div className="bg-white border border-gray-300 rounded p-3" data-testid="maketou-test-form">
        <div className="text-sm font-bold mb-2">Tester la création d'un panier</div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={testPlan}
            onChange={(e) => setTestPlan(e.target.value)}
            className="border-2 border-gray-300 rounded px-2 py-1 text-sm font-bold bg-white"
            data-testid="maketou-test-plan-select"
          >
            {Object.entries(PLAN_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.optionLabel}</option>
            ))}
          </select>
          <Input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="ton-email@example.com"
            className="flex-1 min-w-[180px]"
            data-testid="maketou-test-email-input"
          />
          <Button
            onClick={handleTest}
            disabled={testing || !testEmail.trim()}
            size="sm"
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
            data-testid="maketou-test-btn"
          >
            {testing ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Tester
          </Button>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Crée un panier réel + ouvre le checkout Maketou dans un nouvel onglet pour validation visuelle.
        </div>
      </div>
    </section>
  );
}

