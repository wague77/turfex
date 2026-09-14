"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetHeader,
} from "@/components/ui/sheet";
import { Brain, Loader2, Sparkles, Database, AlertTriangle } from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

/**
 * Bouton qui déclenche une analyse IA (Claude Sonnet 4.5).
 *
 * Props :
 *  - kind: "horse" | "top8"
 *  - payload: { horse, courseContext } ou { top8, courseContext }
 *  - label: texte du bouton (défaut: "Analyser avec l'IA")
 *  - size, variant, className : pass-through au Button shadcn
 *  - icon: composant lucide à afficher (défaut: Brain)
 */
export function AIAnalyzeButton({
  kind = "horse",
  payload,
  label = "Analyser avec l'IA",
  size = "sm",
  variant = "outline",
  className = "",
  icon: Icon = Brain,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { ok, analysis, cached, error }

  const trigger = async () => {
    setOpen(true);
    if (result?.ok) return; // already loaded for this session
    setLoading(true);
    setResult(null);
    try {
      const endpoint = kind === "top8" ? "/ai/analyze-top8" : "/ai/analyze-horse";
      const { data } = await axios.post(`${API}${endpoint}`, payload, {
        timeout: 60000,
      });
      setResult(data);
    } catch (e) {
      setResult({
        ok: false,
        error: e?.response?.data?.detail || e.message || "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={trigger}
        className={`gap-1.5 ${className}`}
        data-testid={`ai-analyze-btn-${kind}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto bg-gradient-to-br from-violet-50 via-white to-pink-50"
          data-testid="ai-analyze-sheet"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-pink-500 flex items-center justify-center text-white shadow">
                <Sparkles className="h-4 w-4" />
              </div>
              {kind === "top8" ? "Analyse IA — Top 8" : "Analyse IA — Cheval"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Synthèse générée par Claude Sonnet 4.5 — précise, factuelle, en français.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6">
            {loading && (
              <div
                className="flex flex-col items-center gap-3 py-12 text-violet-700"
                data-testid="ai-analyze-loading"
              >
                <Loader2 className="h-7 w-7 animate-spin" />
                <p className="text-sm font-bold">Analyse en cours…</p>
                <p className="text-xs text-gray-600 text-center max-w-[260px]">
                  L'IA examine les données et rédige une synthèse — cela prend 5 à 12 secondes.
                </p>
              </div>
            )}

            {!loading && result?.ok && (
              <div
                className="bg-white border-2 border-violet-300 rounded-lg p-4 shadow-sm"
                data-testid="ai-analyze-result"
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider mb-2 text-violet-600 font-bold">
                  {result.cached ? (
                    <>
                      <Database className="h-3 w-3" />
                      Depuis le cache (24h)
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Généré à l'instant
                    </>
                  )}
                </div>
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {result.analysis}
                </div>
              </div>
            )}

            {!loading && result && !result.ok && (
              <div
                className="bg-red-50 border-2 border-red-300 rounded-lg p-4 text-sm"
                data-testid="ai-analyze-error"
              >
                <div className="flex items-center gap-1.5 mb-2 text-red-700 font-bold">
                  <AlertTriangle className="h-4 w-4" />
                  Impossible de générer l'analyse
                </div>
                <div className="text-xs text-red-900 break-words">{result.error}</div>
              </div>
            )}

            <div className="mt-6 text-[10px] text-gray-500 text-center italic">
              L'IA est un outil d'aide. La décision finale t'appartient.
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default AIAnalyzeButton;

