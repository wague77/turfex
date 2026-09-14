"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift, Mail, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
const API = `${BACKEND_URL}/api`;

export const TrialSignup = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // {ok, message, type:'success'|'already'|'error'}

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResult(null);
    const em = email.trim().toLowerCase();
    if (!em || !em.includes("@") || !em.split("@")[1]?.includes(".")) {
      setResult({ ok: false, type: "error", message: "Email invalide" });
      return;
    }
    setLoading(true);
    try {
      const resp = await axios.post(`${API}/visitor/trial`, { email: em });
      const d = resp.data;
      if (d?.created) {
        setResult({
          ok: true,
          type: "success",
          message: d.message || "Inscrit avec succès !",
          trialDate: d.trialDate,
        });
        setEmail("");
      } else if (d?.already) {
        setResult({
          ok: true,
          type: "already",
          message: d.message || "Email déjà connu.",
          alreadyType: d.already,
        });
      } else {
        setResult({ ok: false, type: "error", message: "Réponse inattendue" });
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      let msg = "Erreur";
      if (typeof detail === "string") msg = detail;
      else if (detail?.error) {
        const remaining = detail.remaining;
        const retry = detail.retryAfter;
        if (retry) {
          const mins = Math.ceil(retry / 60);
          msg = `Trop d'inscriptions depuis cette IP. Réessaye dans ${mins} min.`;
        } else {
          msg = `${detail.error}${remaining != null ? ` (${remaining} essai${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""})` : ""}`;
        }
      }
      setResult({ ok: false, type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="border-t-2 border-dashed pt-4 mt-2"
      data-testid="trial-signup-section"
    >
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-row-pink">
          <Gift className="h-3.5 w-3.5" />
          Test gratuit · 1 jour
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Reçois <span className="font-extrabold text-foreground">demain matin à 08h00</span> nos
          pronostics R1 (top 8 chevaux + stats entraineurs) — gratuit, sans engagement.
        </p>
      </div>

      {result?.type === "success" ? (
        <div
          className="bg-green-50 border-2 border-green-300 rounded-lg p-3 text-sm"
          data-testid="trial-signup-success"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-green-900">{result.message}</p>
              {result.trialDate && (
                <p className="text-xs text-green-700 mt-1">
                  Envoi prévu le{" "}
                  <span className="font-mono font-bold">
                    {new Date(result.trialDate).toLocaleDateString("fr-FR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>{" "}
                  à 08h00.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2" data-testid="trial-signup-form">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton-email@exemple.com"
              required
              disabled={loading}
              className="pl-9 bg-white"
              data-testid="trial-signup-email-input"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full bg-row-pink hover:bg-row-pink/90 text-white font-bold disabled:opacity-50"
            data-testid="trial-signup-submit-btn"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Inscription…
              </>
            ) : (
              <>
                <Gift className="h-4 w-4 mr-1" />
                Recevoir mon pronostic gratuit
              </>
            )}
          </Button>
          {result?.type === "already" && (
            <div
              className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-900 flex items-start gap-1.5"
              data-testid="trial-signup-already"
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" />
              <span>{result.message}</span>
            </div>
          )}
          {result?.type === "error" && (
            <div
              className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-900 flex items-start gap-1.5"
              data-testid="trial-signup-error"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-600" />
              <span>{result.message}</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground text-center italic">
            Un seul jour de test gratuit par email · Tu pourras te désabonner à tout moment
          </p>
        </form>
      )}
    </div>
  );
};

export default TrialSignup;

