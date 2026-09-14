"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileArchive, Download, Loader2, Eye } from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

/**
 * SourceExportPanel — Téléchargement du code source TURFEX complet (admin only).
 *
 * Endpoints utilisés :
 *  - GET /api/admin/source-export/preview → métadonnées (taille + 1ères lignes)
 *  - GET /api/admin/source-export → fichier .txt complet (Content-Disposition attachment)
 *
 * Sécurité : header `X-Admin-Password` requis. Les clés API hardcodées sont
 * automatiquement rédactées (`REDACTED_*`) côté backend avant envoi.
 */
export default function SourceExportPanel({ token }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const authHeaders = () => ({ "X-Admin-Password": token });

  const loadPreview = async () => {
    if (!token) return;
    setPreviewLoading(true);
    try {
      const resp = await axios.get(`${API}/admin/source-export/preview`, {
        headers: authHeaders(),
      });
      setPreview(resp.data);
    } catch (err) {
      toast.error("Impossible de charger l'aperçu");
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadFull = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const resp = await axios.get(`${API}/admin/source-export`, {
        headers: authHeaders(),
        responseType: "blob",
      });
      // Récupère le filename depuis le header Content-Disposition
      const cd = resp.headers["content-disposition"] || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = match ? match[1] : `turfex_source_complet_${date}.txt`;

      const url = window.URL.createObjectURL(new Blob([resp.data], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Code source téléchargé (${filename})`);
    } catch (err) {
      const msg = err?.response?.status === 401
        ? "Session admin expirée"
        : "Échec du téléchargement";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="max-w-6xl mx-auto bg-gradient-to-br from-zinc-900 to-black border-2 border-emerald-500 rounded p-5 mb-6 text-white"
      data-testid="source-export-panel"
    >
      <header className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
            <FileArchive className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="font-bold text-lg leading-tight">Code source complet</h2>
            <p className="text-[12px] text-zinc-400">
              Backend + Frontend + Config — clés API automatiquement rédactées
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            onClick={loadPreview}
            disabled={!token || previewLoading}
            variant="outline"
            className="bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-emerald-400"
            data-testid="source-export-preview-btn"
          >
            {previewLoading ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-1.5" />
            )}
            Aperçu
          </Button>
          <Button
            type="button"
            onClick={downloadFull}
            disabled={!token || busy}
            className="bg-emerald-500 text-black font-bold hover:bg-emerald-400"
            data-testid="source-export-download-btn"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Préparation…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1.5" /> Télécharger .txt
              </>
            )}
          </Button>
        </div>
      </header>

      {preview && (
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <div className="bg-black/40 border border-zinc-800 rounded p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Lignes</div>
            <div className="font-mono text-2xl font-bold text-emerald-400">
              {preview.total_lines?.toLocaleString("fr-FR") ?? "—"}
            </div>
          </div>
          <div className="bg-black/40 border border-zinc-800 rounded p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Taille</div>
            <div className="font-mono text-2xl font-bold text-yellow-400">
              {preview.total_bytes
                ? (preview.total_bytes / 1024 / 1024).toFixed(2) + " Mo"
                : "—"}
            </div>
          </div>
          <div className="bg-black/40 border border-zinc-800 rounded p-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Format</div>
            <div className="font-mono text-2xl font-bold text-zinc-300">.txt</div>
          </div>
        </div>
      )}

      {preview?.preview && (
        <details className="mt-2 group" data-testid="source-export-preview-details">
          <summary className="cursor-pointer text-[12px] text-zinc-400 hover:text-emerald-400 select-none">
            Afficher l'en-tête + table des matières (aperçu)
          </summary>
          <pre className="mt-3 max-h-[260px] overflow-auto bg-black border border-zinc-800 rounded p-3 text-[11px] font-mono text-zinc-300 whitespace-pre">
            {preview.preview}
          </pre>
        </details>
      )}

      <div className="mt-4 flex items-start gap-2 text-[12px] text-zinc-400">
        <span className="text-emerald-400">●</span>
        <p>
          Inclut tous les fichiers <span className="text-zinc-200">backend (Python)</span>,{" "}
          <span className="text-zinc-200">frontend src</span>, fichiers de configuration et
          squelettes <span className="text-zinc-200">.env.example</span>. Aucune clé API
          réelle n'est exportée — toute clé hardcodée détectée est remplacée par{" "}
          <code className="text-emerald-400">REDACTED_*</code>.
        </p>
      </div>
    </section>
  );
}

