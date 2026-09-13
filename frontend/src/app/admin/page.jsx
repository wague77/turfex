"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ShieldCheck,
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  RefreshCw,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  Calendar,
  Tag,
  Hash,
  AlertTriangle,
  ShieldAlert,
  FileDown,
  Download,
} from "lucide-react";
const LOGO_SRC = "/logo.svg";
import { useCountdown, formatDuration, parseAuthError } from "@/lib/auth-utils";
import { downloadBatch, downloadAllCodes } from "@/lib/codes-export";
import { EditCodePopover } from "@/components/EditCodePopover";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { EmailNotificationsPanel } from "@/components/EmailNotificationsPanel";
import { DigestHistoryPanel } from "@/components/DigestHistoryPanel";
import { AIUsagePanel } from "@/components/AIUsagePanel";
import { OnlineUsersPanel } from "@/components/OnlineUsersPanel";
import { SubscribersPanel } from "@/components/SubscribersPanel";
import { TrialsPanel } from "@/components/TrialsPanel";
import ResendConfigPanel from "@/components/ResendConfigPanel";
import ResendDomainsPanel from "@/components/ResendDomainsPanel";
import BrevoConfigPanel from "@/components/BrevoConfigPanel";
import MaketouConfigPanel from "@/components/MaketouConfigPanel";
import ChariowConfigPanel from "@/components/ChariowConfigPanel";
import SourceExportPanel from "@/components/SourceExportPanel";
import { APP_NAME, APP_TAGLINE } from "@/lib/branding";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const ADMIN_KEY = "wague-pmu-admin-token";

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch (_) {
    return iso;
  }
};

const daysBetween = (iso) => {
  if (!iso) return null;
  try {
    const target = new Date(iso);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return { days, hours, diffMs, negative: diffMs < 0 };
  } catch (_) {
    return null;
  }
};

const remainingBadge = (iso, mode) => {
  const d = daysBetween(iso);
  if (!d) return null;
  if (d.negative) {
    return <span className="text-[10px] text-red-700 font-bold">Expiré depuis {Math.abs(d.days)}j</span>;
  }
  let color = "bg-green-200 text-green-900";
  if (d.days < 1) color = "bg-red-300 text-red-900";
  else if (d.days < 3) color = "bg-orange-300 text-orange-900";
  else if (d.days < 7) color = "bg-yellow-300 text-yellow-900";
  const label = d.days >= 1 ? `Reste ${d.days}j` : `Reste ${d.hours}h`;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5 ${color}`}>
      ⏳ {label}
    </span>
  );
};

const isoLocalToUtc = (localStr) => {
  // input <input type=datetime-local> → "2026-12-31T23:59"
  if (!localStr) return null;
  try {
    const d = new Date(localStr);
    return d.toISOString();
  } catch (_) {
    return null;
  }
};

const Admin = () => {
  const [token, setToken] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(ADMIN_KEY) || "";
    }
    return "";
  });
  const [pwd, setPwd] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginRemaining, setLoginRemaining] = useState(null);
  const loginLockout = useCountdown(0);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [security, setSecurity] = useState({ user: [], admin: [] });
  const [notifRefreshKey, setNotifRefreshKey] = useState(0);

  // Formulaire création
  const [label, setLabel] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [durationDays, setDurationDays] = useState(30);
  const [exactExpiry, setExactExpiry] = useState("");
  const [count, setCount] = useState(100);
  const [maxUses, setMaxUses] = useState(0);
  const [creating, setCreating] = useState(false);
  const [lastBatch, setLastBatch] = useState(null); // { codes, label }
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  const authHeaders = () => ({ headers: { "X-Admin-Password": token } });

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loginLockout.seconds > 0 || loginLoading) return;
    setLoginLoading(true);
    setLoginError("");
    try {
      const resp = await axios.post(`${API}/admin/login`, { password: pwd });
      const newToken = resp.data?.adminToken;
      if (!newToken) throw new Error("Token manquant");
      sessionStorage.setItem(ADMIN_KEY, newToken);
      setToken(newToken);
      setPwd("");
      setLoginRemaining(null);
    } catch (err) {
      const parsed = parseAuthError(err);
      if (parsed.status === 429 && parsed.retryAfter > 0) {
        loginLockout.start(parsed.retryAfter);
        setLoginError(parsed.message);
        setLoginRemaining(0);
      } else {
        setLoginError(parsed.message);
        if (parsed.remaining != null) setLoginRemaining(parsed.remaining);
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(ADMIN_KEY);
    setToken("");
    setItems([]);
  };

  const loadCodes = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const resp = await axios.get(`${API}/admin/codes`, authHeaders());
      setItems(resp.data?.items || []);
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error("Session admin expirée");
        handleLogout();
      } else {
        toast.error("Erreur de chargement");
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSecurity = async () => {
    if (!token) return;
    try {
      const resp = await axios.get(`${API}/admin/security`, authHeaders());
      setSecurity(resp.data || { user: [], admin: [] });
    } catch (_) {}
  };

  const handleUnlock = async (ip, scope) => {
    try {
      await axios.post(`${API}/admin/security/unlock`, { ip, scope }, authHeaders());
      toast.success(`IP ${ip} déverrouillée`);
      await loadSecurity();
    } catch (_) {
      toast.error("Erreur déverrouillage");
    }
  };

  useEffect(() => {
    if (token) {
      loadCodes();
      loadSecurity();
      const t = setInterval(loadSecurity, 15000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line
  }, [token]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const totalRequested = Number(count);
    if (!totalRequested || totalRequested < 1 || totalRequested > 5000) {
      toast.error("Quantité entre 1 et 5000");
      return;
    }
    setCreating(true);
    setBatchProgress({ done: 0, total: totalRequested });

    const allCreated = [];
    const BATCH_SIZE = 100;
    let remaining = totalRequested;

    try {
      while (remaining > 0) {
        const chunk = Math.min(BATCH_SIZE, remaining);
        const body = {
          label,
          email: emailCode.trim(),
          count: chunk,
          maxUses: Number(maxUses) || 0,
        };
        if (exactExpiry) {
          const iso = isoLocalToUtc(exactExpiry);
          if (!iso) {
            toast.error("Date d'expiration invalide");
            setCreating(false);
            setBatchProgress({ done: 0, total: 0 });
            return;
          }
          body.expiresAt = iso;
        } else {
          body.durationDays = Number(durationDays) || 30;
        }
        const resp = await axios.post(`${API}/admin/codes`, body, authHeaders());
        const created = resp.data?.codes || [];
        allCreated.push(...created);
        remaining -= chunk;
        setBatchProgress({ done: allCreated.length, total: totalRequested });
      }

      toast.success(`${allCreated.length} code(s) générés`);
      setLastBatch({ codes: allCreated, label });

      // Téléchargement automatique du fichier .txt
      downloadBatch(allCreated, { label });

      // Si un seul code, copie aussi dans le presse-papier
      if (allCreated.length === 1 && navigator.clipboard) {
        navigator.clipboard.writeText(allCreated[0].code).catch(() => {});
      }

      setLabel("");
      setEmailCode("");
      await loadCodes();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Erreur création";
      toast.error(typeof msg === "string" ? msg : "Erreur création");
    } finally {
      setCreating(false);
      setTimeout(() => setBatchProgress({ done: 0, total: 0 }), 1500);
    }
  };

  const handleDownloadLastBatch = () => {
    if (!lastBatch) return;
    downloadBatch(lastBatch.codes, { label: lastBatch.label });
  };

  const handleDownloadAll = () => {
    if (!items.length) {
      toast.error("Aucun code à exporter");
      return;
    }
    downloadAllCodes(items);
    toast.success(`${items.length} code(s) exportés`);
  };

  const handleToggleActive = async (it) => {
    try {
      await axios.patch(`${API}/admin/codes/${it.id}`, { active: !it.active }, authHeaders());
      await loadCodes();
    } catch (_) {
      toast.error("Erreur");
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Supprimer le code ${it.code} ?`)) return;
    try {
      await axios.delete(`${API}/admin/codes/${it.id}`, authHeaders());
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      toast.success("Code supprimé");
    } catch (_) {
      toast.error("Erreur");
    }
  };

  const handleCopy = (code) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      toast.success(`Code ${code} copié`);
    }
  };

  // ---- Vue Login ----
  if (!token) {
    const isLocked = loginLockout.seconds > 0;
    const showWarning = loginRemaining != null && loginRemaining > 0 && loginRemaining <= 2;
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-card border-2 border-black rounded-lg p-6 space-y-4 shadow-lg"
        >
          <div className="flex flex-col items-center gap-2">
            <img src={LOGO_SRC} alt={`${APP_NAME} logo`} className="h-16 w-16 object-contain" />
            <div className="text-center">
              <h1 className="text-2xl font-black italic bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {APP_NAME}
              </h1>
              <p className="text-[10px] font-bold tracking-[0.3em] text-muted-foreground">
                {APP_TAGLINE}
              </p>
            </div>
            <h2 className="text-base font-bold flex items-center gap-2 mt-1">
              <ShieldCheck className="h-4 w-4 text-row-pink" />
              Espace administrateur
            </h2>
            <p className="text-xs text-muted-foreground">Mot de passe admin requis</p>
          </div>
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Mot de passe administrateur"
            autoFocus
            disabled={isLocked || loginLoading}
            data-testid="admin-login-password-input"
          />

          {isLocked && (
            <div className="text-sm bg-red-100 border-2 border-red-400 text-red-800 rounded px-3 py-2 flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <div className="font-bold">Trop de tentatives admin</div>
                <div className="text-xs">
                  Verrouillé pour <span className="font-mono font-bold">{formatDuration(loginLockout.seconds)}</span>
                </div>
              </div>
            </div>
          )}

          {!isLocked && loginError && (
            <div className="text-sm bg-destructive/10 border border-destructive/30 text-destructive rounded px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{loginError}</span>
              </div>
              {showWarning && (
                <div className="text-xs mt-1 ml-6 font-bold">
                  ⚠ Plus que <span className="font-mono">{loginRemaining}</span> tentative{loginRemaining > 1 ? "s" : ""} avant verrouillage admin
                </div>
              )}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-row-pink hover:bg-row-pink/90 text-white font-bold disabled:opacity-50"
            disabled={loginLoading || isLocked || !pwd}
            data-testid="admin-login-submit-btn"
          >
            {loginLoading
              ? "Vérification..."
              : isLocked
              ? `Verrouillé (${formatDuration(loginLockout.seconds)})`
              : "Connexion"}
          </Button>
          <Link href="/" className="block text-center text-xs underline text-muted-foreground hover:text-foreground">
            <ArrowLeft className="inline h-3 w-3 mr-1" /> Retour à l'accueil
          </Link>
        </form>
      </main>
    );
  }

  // ---- Vue Dashboard ----
  const stats = {
    total: items.length,
    active: items.filter((it) => it.active && !it.expired && !it.pending).length,
    pending: items.filter((it) => it.pending && it.active).length,
    expired: items.filter((it) => it.expired).length,
    inactive: items.filter((it) => !it.active).length,
  };

  return (
    <main className="min-h-screen bg-background py-6 px-4">
      <header className="max-w-6xl mx-auto mb-6 flex flex-wrap items-center gap-3">
        <img src={LOGO_SRC} alt="Logo" className="h-12 w-12 object-contain" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black italic flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-row-pink" />
            <span className="bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              {APP_NAME}
            </span>
            <span className="text-foreground"> Admin</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="font-bold tracking-widest">{APP_TAGLINE}</span> • Gestion des codes d'accès
          </p>
        </div>
        <Link href="/">
          <Button variant="outline" className="bg-white border-2 border-black">
            <ArrowLeft className="h-4 w-4 mr-1" /> Accueil
          </Button>
        </Link>
        <Button
          onClick={handleDownloadAll}
          variant="outline"
          className="bg-white border-2 border-black hover:bg-blue-100"
          disabled={!items.length}
          title="Exporter tous les codes en .txt"
        >
          <Download className="h-4 w-4 mr-1" /> Exporter tous (.txt)
        </Button>
        <Button onClick={loadCodes} variant="outline" className="bg-white border-2 border-black" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
        </Button>
        <ChangePasswordDialog
          token={token}
          onPasswordChanged={(newToken) => {
            setToken(newToken);
            setNotifRefreshKey((k) => k + 1);
          }}
        />
        <Button onClick={handleLogout} variant="outline" className="bg-white border-2 border-black" data-testid="admin-logout-btn">
          Déconnexion
        </Button>
      </header>

      {/* Stats */}
      <section className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">        <div className="bg-black text-white border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase opacity-70">Total</div>
          <div className="text-2xl font-extrabold">{stats.total}</div>
        </div>
        <div className="bg-caf-green text-caf-green-foreground border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase">Actifs</div>
          <div className="text-2xl font-extrabold">{stats.active}</div>
        </div>
        <div className="bg-blue-200 border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase font-bold">En attente</div>
          <div className="text-2xl font-extrabold">{stats.pending}</div>
        </div>
        <div className="bg-yellow-300 border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase font-bold">Expirés</div>
          <div className="text-2xl font-extrabold">{stats.expired}</div>
        </div>
        <div className="bg-gray-300 border-2 border-black rounded p-3 text-center">
          <div className="text-[10px] uppercase font-bold">Désactivés</div>
          <div className="text-2xl font-extrabold">{stats.inactive}</div>
        </div>
      </section>

      {/* Compteur LIVE utilisateurs en ligne (en haut, position prominente) */}
      <OnlineUsersPanel token={token} />

      {/* Notifications email admin (toggle via .env) */}
      <EmailNotificationsPanel token={token} refreshKey={notifRefreshKey} />

      {/* Configuration Resend API Key — modifiable runtime sans redéploiement */}
      <ResendConfigPanel token={token} />
      <ResendDomainsPanel token={token} />
      <BrevoConfigPanel token={token} />

      {/* Passerelle de paiement Maketou (3 plans : 1m / 3m / 1y) */}
      <MaketouConfigPanel token={token} />

      {/* Passerelle de paiement Chariow (3 URLs configurables : 1m / 3m / 1y) */}
      <ChariowConfigPanel token={token} />

      {/* Téléchargement code source complet (admin only) */}
      <SourceExportPanel token={token} />

      {/* Historique envois digests + CRON externe */}
      <DigestHistoryPanel token={token} />

      {/* Usage IA Claude Sonnet 4.5 */}
      <AIUsagePanel token={token} />

      {/* Abonnés email — pronostics R1 quotidiens */}
      <SubscribersPanel token={token} />

      {/* Trials visiteurs — capture email page de login */}
      <TrialsPanel token={token} />

      {/* Sécurité - IPs sous surveillance */}
      {(security.user.length > 0 || security.admin.length > 0) && (
        <section className="max-w-6xl mx-auto bg-red-50 border-2 border-red-400 rounded p-4 mb-6">
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2 text-red-800">
            <ShieldAlert className="h-5 w-5" />
            Tentatives de brute-force détectées
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {["admin", "user"].map((scope) => {
              const list = security[scope] || [];
              if (list.length === 0) return null;
              return (
                <div key={scope}>
                  <div className="text-xs font-bold uppercase mb-2 text-red-700">
                    {scope === "admin" ? "Espace admin" : "Code utilisateur"} ({list.length})
                  </div>
                  <div className="space-y-1">
                    {list.map((s) => (
                      <div
                        key={s.ip}
                        className={`text-xs flex items-center gap-2 p-2 rounded border ${
                          s.isLocked ? "bg-red-200 border-red-500" : "bg-yellow-100 border-yellow-400"
                        }`}
                      >
                        <span className="font-mono font-bold flex-1 truncate" title={s.ip}>{s.ip}</span>
                        <span className="opacity-70">
                          {s.recentAttempts} récents · {s.totalFailed} total
                        </span>
                        {s.isLocked && (
                          <span className="font-bold text-red-700 inline-flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            {formatDuration(s.lockedRemainingSecs)}
                          </span>
                        )}
                        <Button
                          onClick={() => handleUnlock(s.ip, scope)}
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-green-200"
                          title="Déverrouiller cette IP"
                        >
                          <Unlock className="h-3 w-3 text-green-700" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-red-700 mt-3 italic">
            Verrouillage progressif : 4 échecs admin / 6 échecs utilisateur en 5 min → 10-15 min, puis 20-30 min, puis 1-2h, puis 24h.
          </p>
        </section>
      )}

      {/* Formulaire création */}
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6">
        <h2 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Générer de nouveaux codes
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          💡 Par défaut : la durée commence à compter à la <b>1ère utilisation</b> du code. Pour une date d'expiration absolue, remplis le champ "Date exacte".
        </p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs font-bold flex items-center gap-1">
              <Tag className="h-3 w-3" /> Libellé (optionnel)
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Client Mr. Dupont"
              className="bg-white"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs font-bold flex items-center gap-1">
              <span className="text-row-pink">✉</span> Email abonné (optionnel — reçoit pronostics R1)
            </Label>
            <Input
              type="email"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value)}
              placeholder="client@exemple.com"
              className="bg-white"
              data-testid="create-code-email-input"
            />
          </div>
          <div>
            <Label className="text-xs font-bold flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Durée (jours après 1ère utilisation)
            </Label>
            <Input
              type="number"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              disabled={!!exactExpiry}
              className="bg-white"
            />
          </div>
          <div>
            <Label className="text-xs font-bold">Ou date absolue (mode fixe)</Label>
            <Input
              type="datetime-local"
              value={exactExpiry}
              onChange={(e) => setExactExpiry(e.target.value)}
              className="bg-white"
            />
          </div>
          <div>
            <Label className="text-xs font-bold flex items-center gap-1">
              <Hash className="h-3 w-3" /> Quantité
            </Label>
            <Input
              type="number"
              min="1"
              max="5000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="bg-white"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {[1, 10, 50, 100, 200, 500, 1000].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-bold transition-colors ${
                    Number(count) === n
                      ? "bg-caf-green text-white border-caf-green"
                      : "bg-white border-gray-400 hover:bg-yellow-100"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs font-bold">Utilisations max (0 = illimité)</Label>
            <Input
              type="number"
              min="0"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="bg-white"
            />
          </div>
          <div className="md:col-span-3 flex items-end justify-end gap-2">
            {lastBatch && lastBatch.codes?.length > 0 && (
              <Button
                type="button"
                onClick={handleDownloadLastBatch}
                variant="outline"
                className="border-2 border-black bg-yellow-200 hover:bg-yellow-300 font-bold"
                title={`Re-télécharger le dernier lot (${lastBatch.codes.length} codes)`}
              >
                <FileDown className="h-4 w-4 mr-1" />
                Dernier lot ({lastBatch.codes.length})
              </Button>
            )}
            <Button
              type="submit"
              disabled={creating}
              className="bg-caf-green hover:bg-caf-green/90 text-caf-green-foreground font-bold w-full md:w-auto"
            >
              {creating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  {batchProgress.total > 0
                    ? `${batchProgress.done}/${batchProgress.total}...`
                    : "Génération..."}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" /> Générer + Télécharger .txt
                </>
              )}
            </Button>
          </div>
        </form>
        {creating && batchProgress.total > 100 && (
          <div className="mt-3">
            <div className="text-xs font-bold mb-1 text-muted-foreground">
              Génération par lots de 100 — {batchProgress.done} / {batchProgress.total}
            </div>
            <div className="h-2 bg-gray-200 rounded overflow-hidden">
              <div
                className="h-full bg-caf-green transition-all duration-300"
                style={{
                  width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Liste des codes */}
      <section className="max-w-6xl mx-auto bg-surface border-2 border-black rounded overflow-hidden overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-row-pink text-white">
              <th className="border border-black px-2 py-1 text-left">Code</th>
              <th className="border border-black px-2 py-1 text-left">Libellé</th>
              <th className="border border-black px-2 py-1">Mode</th>
              <th className="border border-black px-2 py-1">1ère utilisation</th>
              <th className="border border-black px-2 py-1">Expire le</th>
              <th className="border border-black px-2 py-1">Utilisations</th>
              <th className="border border-black px-2 py-1">Statut</th>
              <th className="border border-black px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground italic">
                  Aucun code. Génère ton premier code ci-dessus.
                </td>
              </tr>
            )}
            {items.map((it) => {
              const isExpired = it.expired;
              const isInactive = !it.active;
              const isPending = it.pending;
              const usageStr =
                it.maxUses > 0 ? `${it.usedCount}/${it.maxUses}` : `${it.usedCount} (illimité)`;
              const isFromFirst = it.mode === "fromFirstUse";
              return (
                <tr key={it.id} className={`hover:bg-yellow-100/40 transition-colors ${isExpired || isInactive ? "opacity-60" : ""}`}>
                  <td className="border border-black px-2 py-1 font-mono font-bold text-base whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleCopy(it.code)}
                      className="hover:bg-yellow-300 px-2 py-0.5 rounded inline-flex items-center gap-1 transition-colors"
                      title="Copier"
                    >
                      {it.code}
                      <Copy className="h-3 w-3 opacity-50" />
                    </button>
                  </td>
                  <td className="border border-black px-2 py-1 text-xs">{it.label || "—"}</td>
                  <td className="border border-black px-2 py-1 text-center text-xs">
                    {isFromFirst ? (
                      <span className="inline-flex flex-col items-center">
                        <span className="font-bold text-blue-700">Activation</span>
                        <span className="text-[10px]">{it.durationDays}j après 1er usage</span>
                      </span>
                    ) : (
                      <span className="inline-flex flex-col items-center">
                        <span className="font-bold text-purple-700">Date fixe</span>
                        <span className="text-[10px]">absolue</span>
                      </span>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-center text-xs">
                    {it.firstUsedAt ? (
                      formatDate(it.firstUsedAt)
                    ) : isFromFirst ? (
                      <span className="italic text-blue-700">Pas encore utilisé</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`border border-black px-2 py-1 text-center text-xs ${isExpired ? "text-red-600 font-bold" : ""}`}>
                    {isPending ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="italic text-blue-700 font-bold">⏸ Pas démarré</span>
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-200 text-blue-900">
                          ⏱ Durera {it.durationDays}j après 1er usage
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{formatDate(it.expiresAt)}</span>
                        {!isExpired && !isInactive && remainingBadge(it.expiresAt, it.mode)}
                        {isExpired && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-300 text-red-900">
                            ❌ Expiré
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-center text-xs">
                    {usageStr}
                    {it.lastUsedAt && (
                      <div className="text-[10px] opacity-60">dernière : {formatDate(it.lastUsedAt)}</div>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    {isExpired ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded whitespace-nowrap">
                        <XCircle className="h-3 w-3" /> Expiré
                      </span>
                    ) : isInactive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-700 bg-gray-200 px-2 py-0.5 rounded whitespace-nowrap">
                        <Lock className="h-3 w-3" /> Désactivé
                      </span>
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-800 bg-blue-200 px-2 py-0.5 rounded whitespace-nowrap">
                        <AlertTriangle className="h-3 w-3" /> En attente
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-green-800 bg-green-200 px-2 py-0.5 rounded whitespace-nowrap">
                        <CheckCircle2 className="h-3 w-3" /> Actif
                      </span>
                    )}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <EditCodePopover code={it} token={token} onSaved={loadCodes} />
                      <Button
                        onClick={() => handleToggleActive(it)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={it.active ? "Désactiver" : "Réactiver"}
                        disabled={isExpired}
                      >
                        {it.active ? (
                          <Lock className="h-3.5 w-3.5 text-orange-600" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5 text-green-600" />
                        )}
                      </Button>
                      <Button
                        onClick={() => handleDelete(it)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-red-200"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default Admin;

