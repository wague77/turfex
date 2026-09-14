"use client";

/**
 * ChariowConfigPanel — admin UI pour configurer les 3 URLs de checkout Chariow.
 *
 * Pour chaque plan (1m / 3m / 1y), saisie d'une URL Chariow unique.
 * Stocké en MongoDB `app_secrets._id="chariow_url_{plan}"`.
 * Les URLs vides retombent sur les valeurs par défaut.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Save, RefreshCw, ExternalLink, Tag, Trash2 } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

const PLAN_META = {
  "1m": { label: "1 mois", price: "30 €" },
  "3m": { label: "3 mois", price: "80 €", strike: "90 €" },
  "1y": { label: "1 an", price: "260 €", strike: "360 €" },
};

export default function ChariowConfigPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState({ "1m": "", "3m": "", "1y": "" });

  const headers = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/payment/chariow`, headers);
      setData(data);
      const init = {};
      Object.entries(data.plans || {}).forEach(([k, v]) => {
        init[k] = v.source === "db" ? v.url : "";
      });
      setDrafts(init);
    } catch (err) {
      toast.error("Erreur chargement Chariow", {
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

  const save = async () => {
    const payload = {};
    Object.entries(drafts).forEach(([k, v]) => {
      if (v.trim() !== ((data?.plans?.[k]?.source === "db" ? data.plans[k].url : "") || "")) {
        payload[`url${k}`] = v.trim();
      }
    });
    if (Object.keys(payload).length === 0) {
      toast.error("Aucune modification");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/admin/payment/chariow`, payload, headers);
      toast.success("URLs Chariow mises à jour");
      await load();
    } catch (err) {
      toast.error("Erreur sauvegarde", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const resetPlan = async (planKey) => {
    if (!window.confirm(`Restaurer l'URL par défaut pour le plan ${planKey} ?`)) return;
    setSaving(true);
    try {
      await axios.post(`${API}/admin/payment/chariow`, { [`url${planKey}`]: "" }, headers);
      toast.success(`URL ${planKey} restaurée au défaut`);
      await load();
    } catch (err) {
      toast.error("Erreur", { description: err?.response?.data?.detail || err?.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <div className="text-sm text-gray-600">Chargement config Chariow…</div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="chariow-config-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <Tag className="h-5 w-5 text-yellow-700" />
        <h2 className="text-lg font-bold">Passerelle de paiement Chariow · 3 plans</h2>
      </div>

      <div className="text-xs text-gray-600 mb-4">
        URLs de checkout Chariow par plan. Les URLs vides retombent sur les valeurs par défaut.
        Pour activer/désactiver l'affichage de Chariow sur la page de login, utilise les toggles dans le panel <b>Maketou</b>.
      </div>

      <div className="space-y-3" data-testid="chariow-plans-form">
        {Object.entries(PLAN_META).map(([k, meta]) => {
          const planData = data.plans?.[k];
          if (!planData) return null;
          const isDb = planData.source === "db";
          return (
            <div key={k} className="bg-white border-2 border-gray-300 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-bold">
                    Plan {meta.label} ·{" "}
                    <span className="text-amber-700">{meta.price}</span>
                    {meta.strike && (
                      <span className="ml-1 text-[11px] line-through text-gray-500">{meta.strike}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Source : {isDb ? (
                      <span className="font-bold text-violet-700">MongoDB</span>
                    ) : (
                      <span className="font-bold text-emerald-700">défaut</span>
                    )}
                    {planData.updatedAt && isDb && (
                      <span className="ml-2 text-gray-400">
                        · MAJ {new Date(planData.updatedAt).toLocaleString("fr-FR")}
                      </span>
                    )}
                  </div>
                </div>
                {isDb && (
                  <Button
                    onClick={() => resetPlan(k)}
                    disabled={saving}
                    size="sm"
                    variant="outline"
                    className="bg-white border-red-400 text-red-700 hover:bg-red-50"
                    data-testid={`chariow-reset-${k}-btn`}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Restaurer défaut
                  </Button>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  type="url"
                  value={drafts[k]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                  placeholder={planData.default}
                  className="flex-1 font-mono text-xs"
                  data-testid={`chariow-url-${k}-input`}
                />
                {planData.url && (
                  <a
                    href={planData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-700 hover:text-yellow-900"
                    title="Tester ce checkout"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              <div className="text-[10px] text-gray-500 mt-1 truncate">
                URL actuelle : <span className="font-mono">{planData.url}</span>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        onClick={save}
        disabled={saving}
        className="mt-3 bg-gradient-to-r from-yellow-500 to-amber-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
        data-testid="chariow-save-btn"
      >
        {saving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
        Sauvegarder
      </Button>
    </section>
  );
}

