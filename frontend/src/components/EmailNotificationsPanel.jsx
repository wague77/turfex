"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Mail,
  MailCheck,
  MailX,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  KeyRound,
  Ticket,
  CalendarClock,
  CreditCard,
  Trophy,
  BarChart3,
  Star,
  PlayCircle,
  Download,
  Link as LinkIcon,
} from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const EVENT_DEFS = [
  {
    key: "admin_password_changed",
    label: "Changement mot de passe admin",
    desc: "Email envoyé à chaque modification du MDP admin (avec IP, user-agent, date).",
    icon: KeyRound,
    group: "security",
  },
  {
    key: "ip_locked",
    label: "IP verrouillée pour brute-force",
    desc: "Email immédiat dès qu'une IP atteint le seuil (4 admin / 6 user en 5 min).",
    icon: ShieldAlert,
    group: "security",
  },
  {
    key: "code_activated",
    label: "Code d'accès activé (1ère utilisation)",
    desc: "Email à chaque fois qu'un nouveau client utilise son code pour la première fois.",
    icon: Ticket,
    group: "users",
  },
  {
    key: "codes_expired_daily",
    label: "Digest quotidien des codes expirés",
    desc: "Récapitulatif chaque jour à 09h00 UTC des codes ayant expiré dans les 24 dernières heures.",
    icon: CalendarClock,
    group: "users",
    digest: "daily",
  },
  {
    key: "payment_received",
    label: "Nouveau paiement Chariow",
    desc: "Email à chaque webhook de paiement réussi (config Chariow → POST /api/webhook/chariow).",
    icon: CreditCard,
    group: "users",
  },
  {
    key: "bet_won",
    label: "Pari gagnant (au-dessus du seuil)",
    desc: "Email quand un pari passe en 'gagné' avec un gain >= seuil.",
    icon: Trophy,
    group: "bets",
    extra: "threshold",
  },
  {
    key: "weekly_digest",
    label: "Bilan hebdomadaire (lundi 09h UTC)",
    desc: "Stats de la semaine : ROI, win rate, top 3 gains.",
    icon: BarChart3,
    group: "bets",
    digest: "weekly",
  },
  {
    key: "pronostic_grade_a",
    label: "Pronostic Grade A enregistré",
    desc: "Email quand un nouveau pronostic est sauvegardé avec grade='A' (haute confiance).",
    icon: Star,
    group: "pronostics",
  },
  {
    key: "daily_r1_pronostics",
    label: "Pronostics R1 quotidien (08h Paris)",
    desc: "Envoi automatique chaque jour à 08h00 (Europe/Paris) du top 8 par course de la R1 du jour, avec critères et explications, à TOUS les abonnés actifs.",
    icon: Send,
    group: "pronostics",
    digest: "r1-pronostics",
  },
  {
    key: "trial_followup",
    label: "Relance trials J+2 (10h Paris)",
    desc: "Email de relance avec code promo aux visiteurs ayant reçu leur jour de test gratuit il y a 2 jours. Encourage la conversion en abonné payant.",
    icon: Trophy,
    group: "users",
    digest: "trial-followup",
    extra: "promo",
    exportable: "trial-followup",
  },
];

const GROUP_LABELS = {
  security: { label: "🔒 Sécurité", color: "border-red-300 bg-red-50" },
  users: { label: "👥 Utilisateurs / Codes", color: "border-blue-300 bg-blue-50" },
  bets: { label: "🏇 Paris / ROI", color: "border-yellow-300 bg-yellow-50" },
  pronostics: { label: "🏆 Pronostics", color: "border-purple-300 bg-purple-50" },
};

export const EmailNotificationsPanel = ({ token, refreshKey = 0 }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [promoDraft, setPromoDraft] = useState("");
  const [discountDraft, setDiscountDraft] = useState("");
  const [paymentUrlDraft, setPaymentUrlDraft] = useState("");
  const [digestRunning, setDigestRunning] = useState(null);
  const [exporting, setExporting] = useState(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/admin/notifications/status`, {
        headers: { "X-Admin-Password": token },
      });
      setStatus(resp.data);
      const t = resp.data?.settings?.bet_won_threshold;
      if (t != null) setThresholdDraft(String(t));
      const p = resp.data?.settings?.trial_followup_promo_code;
      if (p != null) setPromoDraft(String(p));
      const dl = resp.data?.settings?.trial_followup_discount_label;
      if (dl != null) setDiscountDraft(String(dl));
      const pu = resp.data?.settings?.subscription_payment_url;
      if (pu != null) setPaymentUrlDraft(String(pu));
    } catch (_) {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [token, refreshKey]);

  const enabled = !!status?.enabled;
  const settings = status?.settings || {};

  const grouped = useMemo(() => {
    const out = { security: [], users: [], bets: [], pronostics: [] };
    EVENT_DEFS.forEach((e) => {
      if (out[e.group]) out[e.group].push(e);
    });
    return out;
  }, []);

  const patchSetting = async (patch) => {
    try {
      const resp = await axios.patch(
        `${API}/admin/notifications/settings`,
        patch,
        { headers: { "X-Admin-Password": token } }
      );
      setStatus((prev) => (prev ? { ...prev, settings: resp.data?.settings || prev.settings } : prev));
      const t = resp.data?.settings?.bet_won_threshold;
      if (t != null) setThresholdDraft(String(t));
      const p = resp.data?.settings?.trial_followup_promo_code;
      if (p != null) setPromoDraft(String(p));
      const dl = resp.data?.settings?.trial_followup_discount_label;
      if (dl != null) setDiscountDraft(String(dl));
      const pu = resp.data?.settings?.subscription_payment_url;
      if (pu != null) setPaymentUrlDraft(String(pu));
      return true;
    } catch (err) {
      toast.error("Erreur sauvegarde", {
        description: err?.response?.data?.detail || err?.message || "—",
      });
      return false;
    }
  };

  const handleToggle = async (key, val) => {
    setSavingKey(key);
    await patchSetting({ [key]: val });
    setSavingKey(null);
  };

  const handleThresholdSave = async () => {
    const n = Number(thresholdDraft);
    if (Number.isNaN(n) || n < 0) {
      toast.error("Seuil invalide");
      return;
    }
    setSavingKey("bet_won_threshold");
    const ok = await patchSetting({ bet_won_threshold: n });
    setSavingKey(null);
    if (ok) toast.success(`Seuil pari gagnant : ${n} €`);
  };

  const handlePromoSave = async () => {
    const code = (promoDraft || "").trim().toUpperCase();
    const label = (discountDraft || "").trim();
    if (!code || code.length < 3) {
      toast.error("Code promo trop court (min 3 car)");
      return;
    }
    setSavingKey("trial_followup_promo_code");
    const ok = await patchSetting({
      trial_followup_promo_code: code,
      trial_followup_discount_label: label || "5 € de réduction",
    });
    setSavingKey(null);
    if (ok) toast.success(`Code promo : ${code}`);
  };

  const handlePaymentUrlSave = async () => {
    const url = (paymentUrlDraft || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      toast.error("URL invalide", { description: "Doit commencer par http:// ou https://" });
      return;
    }
    setSavingKey("subscription_payment_url");
    const ok = await patchSetting({ subscription_payment_url: url });
    setSavingKey(null);
    if (ok) toast.success("Lien Chariow mis à jour", { description: url });
  };

  const handleExport = async (kind) => {
    setExporting(kind);
    try {
      const resp = await axios.get(
        `${API}/admin/notifications/digest/${kind}/export`,
        {
          headers: { "X-Admin-Password": token },
          responseType: "blob",
        }
      );
      // Récupère le filename depuis Content-Disposition si dispo
      const disp = resp.headers?.["content-disposition"] || "";
      const match = disp.match(/filename="?([^"]+)"?/i);
      const fallback = `turfex-${kind}-${new Date().toISOString().slice(0, 10)}.html`;
      const filename = match ? match[1] : fallback;
      const blob = new Blob([resp.data], { type: "text/html;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("HTML téléchargé", { description: filename });
    } catch (err) {
      toast.error("Erreur export", {
        description: err?.response?.data?.detail || err?.message || "—",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const resp = await axios.post(
        `${API}/admin/notifications/test`,
        {},
        { headers: { "X-Admin-Password": token } }
      );
      if (resp.data?.ok) {
        toast.success("Email de test envoyé", {
          description: `ID Resend : ${resp.data.id || "—"}. Vérifie ta boîte.`,
          icon: <MailCheck className="h-4 w-4 text-green-600" />,
        });
      } else {
        toast.error("Échec envoi test", {
          description: resp.data?.error || "Erreur inconnue",
          icon: <MailX className="h-4 w-4 text-red-600" />,
        });
      }
    } catch (err) {
      toast.error("Erreur réseau", {
        description: err?.response?.data?.detail || err?.message || "—",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDigestRun = async (kind) => {
    setDigestRunning(kind);
    try {
      // Pour trial-followup, on force pour ignorer la fenêtre J-3..J-1 (utile en test manuel)
      const body = kind === "trial-followup" ? { force_all_used: true } : {};
      const resp = await axios.post(
        `${API}/admin/notifications/digest/${kind}`,
        body,
        { headers: { "X-Admin-Password": token } }
      );
      if (resp.data?.ok) {
        const labels = { daily: "quotidien", weekly: "hebdo", "r1-pronostics": "R1 pronostics", "trial-followup": "relance trials" };
        toast.success(`Digest ${labels[kind] || kind} envoyé`, {
          description: resp.data.sent != null
            ? `${resp.data.sent} email${resp.data.sent > 1 ? "s" : ""} envoyé${resp.data.sent > 1 ? "s" : ""}${resp.data.eligible != null ? ` sur ${resp.data.eligible} éligible(s)` : ""}`
            : `ID Resend : ${resp.data.id || "—"}`,
        });
      } else {
        toast.warning(`Digest non envoyé`, {
          description: resp.data?.error || "Pas de données pertinentes ou désactivé.",
        });
      }
    } catch (err) {
      toast.error("Erreur", {
        description: err?.response?.data?.detail || err?.message || "—",
      });
    } finally {
      setDigestRunning(null);
    }
  };

  if (!status) {
    return (
      <div
        className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-3 mb-6 text-xs text-muted-foreground italic"
        data-testid="email-notifications-panel-loading"
      >
        Chargement de l'état des notifications email…
      </div>
    );
  }

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="email-notifications-panel"
    >
      {/* Header compact */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {enabled ? (
            <MailCheck className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <MailX className="h-5 w-5 text-gray-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
              Notifications email admin
              {enabled ? (
                <span
                  className="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-green-200 text-green-900"
                  data-testid="email-notifications-status-enabled"
                >
                  ✓ ACTIF
                </span>
              ) : (
                <span
                  className="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-gray-300 text-gray-800"
                  data-testid="email-notifications-status-disabled"
                >
                  DÉSACTIVÉ
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {enabled ? (
                <>
                  Destinataire : <span className="font-mono font-bold text-foreground">{status.recipientMasked}</span>{" "}
                  · Expéditeur : <span className="font-mono">{status.sender}</span>
                </>
              ) : (
                <>
                  Définis <code className="bg-muted px-1">RESEND_API_KEY</code> et{" "}
                  <code className="bg-muted px-1">ADMIN_NOTIFICATION_EMAIL</code> dans{" "}
                  <code className="bg-muted px-1">backend/.env</code>, puis redémarre le backend.
                </>
              )}
            </div>
          </div>
        </div>
        <Button
          onClick={load}
          variant="outline"
          size="sm"
          className="bg-white border-2 border-black"
          disabled={loading}
          data-testid="email-notifications-refresh-btn"
          title="Recharger"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          onClick={handleTest}
          disabled={!enabled || testing}
          className="bg-row-pink hover:bg-row-pink/90 text-white font-bold disabled:opacity-40"
          size="sm"
          data-testid="email-notifications-test-btn"
        >
          {testing ? (
            <>
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Envoi…
            </>
          ) : (
            <>
              <Send className="h-3 w-3 mr-1" /> Tester
            </>
          )}
        </Button>
      </div>

      {/* Panneau pliable des toggles */}
      {enabled && (
        <Collapsible open={showSettings} onOpenChange={setShowSettings} className="mt-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs font-bold inline-flex items-center gap-1 hover:bg-yellow-100"
              data-testid="email-notifications-settings-toggle"
            >
              {showSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showSettings ? "Masquer les événements" : "Configurer les événements surveillés"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-3" data-testid="email-notifications-events-grid">
              {Object.entries(grouped).map(([group, events]) => {
                const meta = GROUP_LABELS[group];
                return (
                  <div
                    key={group}
                    className={`border-2 ${meta.color} rounded p-3`}
                    data-testid={`event-group-${group}`}
                  >
                    <div className="font-bold text-xs uppercase tracking-wider mb-2">{meta.label}</div>
                    <div className="space-y-2">
                      {events.map((evt) => {
                        const Icon = evt.icon;
                        const isOn = !!settings[evt.key];
                        return (
                          <div
                            key={evt.key}
                            className="flex items-start gap-3 bg-white border border-gray-200 rounded p-2.5"
                            data-testid={`event-row-${evt.key}`}
                          >
                            <Icon className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-sm">{evt.label}</div>
                              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                                {evt.desc}
                              </div>
                              {evt.extra === "threshold" && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Label className="text-[11px] font-bold whitespace-nowrap">
                                    Seuil :
                                  </Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="10"
                                    value={thresholdDraft}
                                    onChange={(e) => setThresholdDraft(e.target.value)}
                                    className="h-7 w-24 text-xs bg-white"
                                    data-testid="bet-won-threshold-input"
                                  />
                                  <span className="text-xs">€</span>
                                  <Button
                                    onClick={handleThresholdSave}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs bg-yellow-100 border-2 border-black hover:bg-yellow-200"
                                    disabled={savingKey === "bet_won_threshold"}
                                    data-testid="bet-won-threshold-save-btn"
                                  >
                                    OK
                                  </Button>
                                </div>
                              )}
                              {evt.extra === "promo" && (
                                <>
                                  <div className="flex flex-wrap items-center gap-2 mt-2">
                                    <Label className="text-[11px] font-bold whitespace-nowrap">
                                      Code promo :
                                    </Label>
                                    <Input
                                      type="text"
                                      value={promoDraft}
                                      onChange={(e) => setPromoDraft(e.target.value.toUpperCase())}
                                      placeholder="TURFEX5"
                                      maxLength={20}
                                      className="h-7 w-32 text-xs bg-white font-mono uppercase"
                                      data-testid="trial-followup-promo-input"
                                    />
                                    <Label className="text-[11px] font-bold whitespace-nowrap">
                                      Réduction :
                                    </Label>
                                    <Input
                                      type="text"
                                      value={discountDraft}
                                      onChange={(e) => setDiscountDraft(e.target.value)}
                                      placeholder="5 € de réduction"
                                      maxLength={50}
                                      className="h-7 w-44 text-xs bg-white"
                                      data-testid="trial-followup-discount-input"
                                    />
                                    <Button
                                      onClick={handlePromoSave}
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-yellow-100 border-2 border-black hover:bg-yellow-200"
                                      disabled={savingKey === "trial_followup_promo_code"}
                                      data-testid="trial-followup-promo-save-btn"
                                    >
                                      OK
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 mt-2">
                                    <Label className="text-[11px] font-bold whitespace-nowrap inline-flex items-center gap-1">
                                      <LinkIcon className="h-3 w-3" />
                                      Lien Chariow :
                                    </Label>
                                    <Input
                                      type="url"
                                      value={paymentUrlDraft}
                                      onChange={(e) => setPaymentUrlDraft(e.target.value)}
                                      placeholder="https://ygsftwvy.mychariow.shop/checkout/prd_dh34ze"
                                      className="h-7 flex-1 min-w-[220px] text-xs bg-white font-mono"
                                      data-testid="subscription-payment-url-input"
                                    />
                                    <Button
                                      onClick={handlePaymentUrlSave}
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-yellow-100 border-2 border-black hover:bg-yellow-200"
                                      disabled={savingKey === "subscription_payment_url"}
                                      data-testid="subscription-payment-url-save-btn"
                                    >
                                      OK
                                    </Button>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground italic mt-1">
                                    Utilisé par le bouton "🚀 Activer mon abonnement TURFEX" de l'email & de l'export HTML.
                                  </p>
                                </>
                              )}
                              {evt.digest && (
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  <Button
                                    onClick={() => handleDigestRun(evt.digest)}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs bg-white border-2 border-black hover:bg-pink-100"
                                    disabled={digestRunning === evt.digest}
                                    data-testid={`digest-run-${evt.digest}-btn`}
                                  >
                                    <PlayCircle className="h-3 w-3 mr-1" />
                                    {digestRunning === evt.digest ? "Envoi…" : "Lancer maintenant"}
                                  </Button>
                                  {evt.exportable && (
                                    <Button
                                      onClick={() => handleExport(evt.exportable)}
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-white border-2 border-black hover:bg-yellow-100"
                                      disabled={exporting === evt.exportable}
                                      data-testid={`digest-export-${evt.exportable}-btn`}
                                      title="Télécharger le HTML de l'email (admin uniquement)"
                                    >
                                      <Download className="h-3 w-3 mr-1" />
                                      {exporting === evt.exportable ? "Export…" : "Exporter HTML"}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                            <Switch
                              checked={isOn}
                              onCheckedChange={(v) => handleToggle(evt.key, v)}
                              disabled={savingKey === evt.key}
                              data-testid={`event-toggle-${evt.key}`}
                              aria-label={`Activer ${evt.label}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground italic flex items-center gap-1 mt-2">
                <Mail className="h-3 w-3" />
                Les digests s'exécutent automatiquement (quotidien 09h UTC, hebdo lundi 09h UTC). Les événements
                instantanés se déclenchent en temps réel à chaque action.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
};

export default EmailNotificationsPanel;

