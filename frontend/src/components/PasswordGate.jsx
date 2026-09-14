"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Settings as SettingsIcon, AlertTriangle, Lock, Sparkles, ShoppingCart } from "lucide-react";
// Logo depuis public/ (Next.js ne supporte pas les imports SVG directs sans @svgr/webpack)
const LOGO_SRC = "/logo.svg";
import { useCountdown, formatDuration, parseAuthError } from "@/lib/auth-utils";
import { ChariowPlansWidget } from "@/components/ChariowPlansWidget";
import { MaketouSubscriptionWidget } from "@/components/MaketouSubscriptionWidget";
import { TrialSignup } from "@/components/TrialSignup";
import { APP_NAME, APP_TAGLINE } from "@/lib/branding";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;
const STORAGE_KEY = "wague-pmu-auth";

const formatExpiry = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch (_) {
    return iso;
  }
};

export const PasswordGate = ({ children }) => {
  const [authed, setAuthed] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [providers, setProviders] = useState(["maketou"]); // défaut Maketou pendant chargement
  const [chariowUrls, setChariowUrls] = useState({});
  const lockout = useCountdown(0);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.expiresAt && new Date(data.expiresAt) > new Date()) {
          setAuthed(true);
          setInfo(data);
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (_) {}
  }, []);

  // Charge la config publique des providers de paiement
  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/payment/providers`)
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data?.providers) && data.providers.length ? data.providers : ["maketou"];
        setProviders(list);
        setChariowUrls(data?.chariowUrls || {});
      })
      .catch(() => {
        // silencieux : on garde le défaut Maketou
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (lockout.seconds > 0 || loading) return;
    setLoading(true);
    setError("");
    try {
      const code = value.trim().toUpperCase();
      const resp = await axios.post(`${API}/auth/validate-code`, { code });
      const data = resp.data;
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          code,
          expiresAt: data.expiresAt,
          label: data.label,
          validatedAt: new Date().toISOString(),
          activatedNow: !!data.activatedNow,
        })
      );
      setInfo({
        code,
        expiresAt: data.expiresAt,
        label: data.label,
        activatedNow: !!data.activatedNow,
        durationDays: data.durationDays,
      });
      setAuthed(true);
    } catch (err) {
      const parsed = parseAuthError(err);
      if (parsed.status === 429 && parsed.retryAfter > 0) {
        lockout.start(parsed.retryAfter);
        setError(parsed.message);
        setRemaining(0);
      } else {
        setError(parsed.message);
        if (parsed.remaining != null) setRemaining(parsed.remaining);
      }
    } finally {
      setLoading(false);
    }
  };

  if (authed) {
    return (
      <>
        {children}
        {info?.activatedNow && (
          <div className="fixed top-2 right-2 z-50 bg-blue-600 text-white px-4 py-2 rounded shadow-lg animate-pulse pointer-events-none">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <div className="text-xs">
                <div className="font-bold">Code activé</div>
                <div>Valide {info.durationDays} jours à partir de maintenant</div>
              </div>
            </div>
          </div>
        )}
        {info?.expiresAt && (
          <div className="fixed bottom-2 left-2 z-50 text-[10px] bg-black/70 text-white px-2 py-1 rounded font-mono pointer-events-none">
            Accès valide jusqu'au {formatExpiry(info.expiresAt)}
          </div>
        )}
      </>
    );
  }

  const isLocked = lockout.seconds > 0;
  const showWarning = remaining != null && remaining > 0 && remaining <= 3;

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-6 bg-black bg-no-repeat bg-cover bg-center relative"
      style={{ backgroundImage: "url('/turfex-hero-bg.png')" }}
      data-testid="password-gate-hero"
    >
      {/* Overlay sombre pour lisibilité du formulaire centré */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/70 via-black/55 to-black/75 pointer-events-none" />

      {/* Halo lumineux sous la carte */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[420px] h-[420px] rounded-full bg-green-500/20 blur-[120px]" />
      </div>

      <div
        className="w-full max-w-md relative z-10 bg-card/95 backdrop-blur-xl border-2 border-green-400/60 rounded-2xl p-6 space-y-4 shadow-[0_0_60px_rgba(34,197,94,0.35)]"
        data-testid="password-gate-card"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col items-center gap-2">
          <img src={LOGO_SRC} alt={`${APP_NAME} logo`} className="h-16 w-16 object-contain" />
          <div className="text-center">
            <h1 className="text-2xl font-black italic bg-gradient-to-r from-pink-500 via-yellow-400 via-green-400 to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              {APP_NAME}
            </h1>
            <p className="text-[10px] font-bold tracking-[0.3em] text-muted-foreground">
              {APP_TAGLINE}
            </p>
          </div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2 mt-1">
            <ShieldCheck className="h-4 w-4 text-caf-green" />
            Code d'accès
          </h2>
          <p className="text-xs text-muted-foreground text-center">
            Entrez le code communiqué par l'administrateur
          </p>
        </div>
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX"
          autoFocus
          className="text-center font-mono tracking-widest text-lg uppercase"
          maxLength={20}
          disabled={isLocked || loading}
        />

        {isLocked && (
          <div className="text-sm bg-red-100 border-2 border-red-400 text-red-800 rounded px-3 py-2 flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            <div className="flex-1">
              <div className="font-bold">Trop de tentatives</div>
              <div className="text-xs">
                Réessaie dans <span className="font-mono font-bold">{formatDuration(lockout.seconds)}</span>
              </div>
            </div>
          </div>
        )}

        {!isLocked && error && (
          <div className="text-sm bg-destructive/10 border border-destructive/30 text-destructive rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
            {showWarning && (
              <div className="text-xs mt-1 ml-6 font-bold">
                ⚠ Plus que <span className="font-mono">{remaining}</span> tentative{remaining > 1 ? "s" : ""} avant verrouillage
              </div>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-caf-green hover:bg-caf-green/90 text-caf-green-foreground font-bold disabled:opacity-50"
          disabled={loading || isLocked || !value.trim()}
        >
          {loading
            ? "Vérification..."
            : isLocked
            ? `Verrouillé (${formatDuration(lockout.seconds)})`
            : "Entrer"}
        </Button>

        <Link
          href="/admin"
          className="block text-center text-xs text-muted-foreground hover:text-foreground underline transition-colors"
        >
          <SettingsIcon className="inline h-3 w-3 mr-1" />
          Espace administrateur
        </Link>

        {/* === Section achat de code === */}
        <div className="border-t-2 border-dashed pt-4 mt-2">
          <div className="text-center mb-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-row-pink">
              <ShoppingCart className="h-3.5 w-3.5" />
              Pas encore de code ?
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Choisis ton abonnement TURFEX et reçois ton code par email
            </p>
          </div>

          {providers.includes("maketou") && (
            <div className="mb-3">
              <MaketouSubscriptionWidget />
            </div>
          )}

          {providers.includes("chariow") && (
            <div className={providers.length > 1 ? "mt-4 pt-3 border-t border-dashed" : ""}>
              {providers.length > 1 && (
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground text-center mb-2 font-bold">
                  ou via Chariow
                </div>
              )}
              <ChariowPlansWidget urls={chariowUrls} />
            </div>
          )}
        </div>
        </form>

        {/* === Section trial gratuit (lead capture) — HORS form pour éviter form imbriqué === */}
        <TrialSignup />
      </div>
    </main>
  );
};

