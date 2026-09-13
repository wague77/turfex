"use client";

/**
 * PaymentSuccess — page de retour après paiement Maketou.
 *
 * Lit `cartId` depuis sessionStorage (ou query string `?cartId=...`),
 * poll le backend (`GET /api/payment/maketou/cart/:id`) toutes les 3s
 * jusqu'à recevoir le statut `completed` + le code d'accès TURFEX généré.
 *
 * Affiche le code en gros, avec bouton "Copier" et "Aller au site"
 * qui pré-remplit le code dans le sessionStorage utilisé par PasswordGate.
 */
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Copy, ArrowRight, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
const LOGO_SRC = "/logo.svg";
import { APP_NAME, APP_TAGLINE } from "@/lib/branding";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // ~6 minutes max

const PaymentSuccessContent = () => {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("polling");
  const [cartInfo, setCartInfo] = useState(null);
  const [accessCode, setAccessCode] = useState(null);
  const [error, setError] = useState("");
  const [pollCount, setPollCount] = useState(0);
  const cartIdRef = useRef(null);
  const planRef = useRef(null);
  const emailRef = useRef(null);

  // Récupération cartId : query string en priorité, sinon sessionStorage
  useEffect(() => {
    const queryCartId = params.get("cartId");
    let cid = queryCartId || null;
    let plan = null;
    let email = null;
    try {
      const stored = sessionStorage.getItem("turfex-maketou-cart");
      if (stored) {
        const data = JSON.parse(stored);
        if (!cid) cid = data.cartId;
        plan = data.plan;
        email = data.email;
      }
    } catch (_) {}
    if (!cid) {
      setStatus("missing");
      setError("Aucun panier détecté. As-tu bien lancé un paiement ?");
      return;
    }
    cartIdRef.current = cid;
    planRef.current = plan;
    emailRef.current = email;
    setCartInfo({ cartId: cid, plan, email });
  }, [params]);

  const errorCountRef = useRef(0);

  const pollStatus = useCallback(async () => {
    const cid = cartIdRef.current;
    if (!cid) return;
    try {
      const { data } = await axios.get(`${API}/payment/maketou/cart/${cid}`);
      errorCountRef.current = 0;
      const s = data?.status;
      if (s === "completed") {
        setStatus("success");
        if (data?.accessCode) {
          setAccessCode(data.accessCode);
          // Pré-active le code côté front pour le rendre dispo dans PasswordGate
          try {
            sessionStorage.setItem(
              "wague-pmu-auth",
              JSON.stringify({
                code: data.accessCode.code,
                expiresAt: data.accessCode.expiresAt,
                label: data.accessCode.label,
                validatedAt: new Date().toISOString(),
                activatedNow: true,
              })
            );
          } catch (_) {}
        }
      } else if (s === "payment_failed") {
        setStatus("failed");
        setError("Le paiement a échoué. Tu peux réessayer.");
      } else if (s === "abandoned") {
        setStatus("abandoned");
        setError("Le paiement a été abandonné.");
      } else {
        setPollCount((c) => c + 1);
      }
    } catch (err) {
      const code = err?.response?.status;
      // 404 = panier inconnu : on s'arrête immédiatement
      if (code === 404) {
        setStatus("missing");
        setError("Panier introuvable. Le lien de paiement est peut-être périmé.");
        return;
      }
      errorCountRef.current += 1;
      // Au-delà de 5 erreurs réseau consécutives, on arrête le polling
      if (errorCountRef.current >= 5) {
        setStatus("timeout");
        setError("Impossible de joindre le serveur de paiement. Vérifie tes emails ou réessaie plus tard.");
        return;
      }
      setPollCount((c) => c + 1);
    }
  }, []);

  useEffect(() => {
    if (status !== "polling") return;
    if (pollCount >= MAX_POLLS) {
      setStatus("timeout");
      setError("Pas de confirmation reçue après 6 minutes. Vérifie tes emails ou contacte le support.");
      return;
    }
    const t = setTimeout(pollStatus, pollCount === 0 ? 500 : POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [status, pollCount, pollStatus]);

  const handleCopy = () => {
    if (!accessCode?.code) return;
    navigator.clipboard.writeText(accessCode.code).then(
      () => toast.success("Code copié !"),
      () => toast.error("Copie impossible — copie manuellement")
    );
  };

  const handleGoApp = () => {
    router.push("/");
  };

  const formatExpiry = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    } catch (_) {
      return iso;
    }
  };

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-6 bg-black bg-no-repeat bg-cover bg-center relative"
      style={{ backgroundImage: "url('/turfex-hero-bg.png')" }}
      data-testid="payment-success-page"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/65 to-black/85 pointer-events-none" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[460px] h-[460px] rounded-full bg-emerald-500/25 blur-[140px]" />
      </div>

      <div className="w-full max-w-md relative z-10 bg-card/95 backdrop-blur-xl border-2 border-emerald-400/60 rounded-2xl p-6 space-y-4 shadow-[0_0_70px_rgba(34,197,94,0.4)]">
        <div className="flex flex-col items-center gap-2">
          <img src={LOGO_SRC} alt={`${APP_NAME} logo`} className="h-14 w-14 object-contain" />
          <div className="text-center">
            <h1
              className="text-2xl font-black italic bg-gradient-to-r from-pink-500 via-yellow-400 via-green-400 to-cyan-400 bg-clip-text text-transparent"
              style={{ fontFamily: "Impact, 'Arial Black', sans-serif" }}
            >
              {APP_NAME}
            </h1>
            <p className="text-[10px] font-bold tracking-[0.3em] text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </div>

        {status === "polling" && (
          <div
            className="text-center space-y-3 py-4"
            data-testid="payment-status-polling"
          >
            <Loader2 className="h-12 w-12 mx-auto text-amber-500 animate-spin" />
            <h2 className="text-lg font-bold">Vérification du paiement…</h2>
            <p className="text-xs text-muted-foreground">
              Cette opération prend quelques secondes. Ne ferme pas cette page.
            </p>
            {cartInfo?.cartId && (
              <p className="text-[10px] font-mono text-muted-foreground/70">
                Réf : {cartInfo.cartId.slice(0, 8)}…
              </p>
            )}
          </div>
        )}

        {status === "success" && accessCode && (
          <div className="space-y-4" data-testid="payment-status-success">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <h2 className="text-lg font-bold flex items-center gap-2">
                Paiement validé <Sparkles className="h-4 w-4 text-amber-500" />
              </h2>
              <p className="text-xs text-muted-foreground">
                Bienvenue dans {APP_NAME} · {accessCode.label}
              </p>
            </div>

            <div className="bg-emerald-50 dark:bg-emerald-900/20 border-2 border-dashed border-emerald-400 rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400 font-bold mb-1">
                Ton code d'accès
              </div>
              <div
                className="font-mono text-2xl font-black tracking-[0.15em] text-foreground select-all break-all"
                data-testid="access-code-display"
              >
                {accessCode.code}
              </div>
              <Button
                onClick={handleCopy}
                size="sm"
                variant="outline"
                className="mt-2"
                data-testid="copy-access-code-btn"
              >
                <Copy className="h-3 w-3 mr-1" />
                Copier
              </Button>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                <span>Le code a aussi été envoyé à ton email.</span>
              </div>
              <div>
                Valide jusqu'au <b className="text-foreground">{formatExpiry(accessCode.expiresAt)}</b>.
              </div>
            </div>

            <Button
              onClick={handleGoApp}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-bold"
              data-testid="goto-app-btn"
            >
              Accéder à TURFEX
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}

        {(status === "failed" || status === "abandoned" || status === "timeout" || status === "missing") && (
          <div
            className="space-y-3 text-center py-2"
            data-testid={`payment-status-${status}`}
          >
            <AlertCircle className="h-12 w-12 mx-auto text-rose-500" />
            <h2 className="text-lg font-bold">
              {status === "failed" && "Paiement échoué"}
              {status === "abandoned" && "Paiement abandonné"}
              {status === "timeout" && "Délai dépassé"}
              {status === "missing" && "Aucun panier"}
            </h2>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button
              onClick={() => router.push("/")}
              variant="outline"
              className="w-full"
              data-testid="back-home-btn"
            >
              Retour à l'accueil
            </Button>
          </div>
        )}
      </div>
    </main>
  );
};

export default function PaymentSuccess() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-black" />}>
      <PaymentSuccessContent />
    </React.Suspense>
  );
}

