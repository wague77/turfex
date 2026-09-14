"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pencil, Calendar, Plus, RefreshCw, Tag, Hash, Save } from "lucide-react";
import { toast } from "sonner";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const isoToLocalInput = (iso) => {
  // ISO → format "YYYY-MM-DDTHH:MM" pour datetime-local
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return "";
  }
};

const localToIso = (local) => {
  if (!local) return null;
  try {
    return new Date(local).toISOString();
  } catch (_) {
    return null;
  }
};

export const EditCodePopover = ({ code, token, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(code.label || "");
  const [maxUses, setMaxUses] = useState(code.maxUses || 0);
  const [durationDays, setDurationDays] = useState(code.durationDays || 30);
  const [newExpiry, setNewExpiry] = useState(isoToLocalInput(code.expiresAt));
  const [extendDays, setExtendDays] = useState(0);
  const [saving, setSaving] = useState(false);

  const isFromFirst = code.mode === "fromFirstUse";
  const isPending = isFromFirst && !code.firstUsedAt;
  const headers = { headers: { "X-Admin-Password": token } };

  const reset = () => {
    setLabel(code.label || "");
    setMaxUses(code.maxUses || 0);
    setDurationDays(code.durationDays || 30);
    setNewExpiry(isoToLocalInput(code.expiresAt));
    setExtendDays(0);
  };

  const send = async (body, message) => {
    setSaving(true);
    try {
      await axios.patch(`${API}/admin/codes/${code.id}`, body, headers);
      toast.success(message || "Modifié");
      setOpen(false);
      onSaved?.();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Erreur";
      toast.error(typeof msg === "string" ? msg : "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickExtend = (days) => {
    if (saving) return;
    send({ extendDays: days }, `+${days} jour(s) ajouté(s)`);
  };

  const handleSetExpiry = () => {
    const iso = localToIso(newExpiry);
    if (!iso) {
      toast.error("Date invalide");
      return;
    }
    send({ expiresAt: iso }, "Date d'expiration mise à jour");
  };

  const handleSetDuration = () => {
    const d = Number(durationDays);
    if (!d || d < 1) {
      toast.error("Durée invalide");
      return;
    }
    send({ durationDays: d }, `Durée fixée à ${d} jours`);
  };

  const handleMeta = () => {
    send(
      { label, maxUses: Number(maxUses) || 0 },
      "Libellé / quota mis à jour"
    );
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-blue-200"
          title="Modifier ce code"
        >
          <Pencil className="h-3.5 w-3.5 text-blue-700" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 bg-white border-2 border-black p-4" align="end">
        <div className="space-y-4">
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              <Pencil className="h-4 w-4 text-blue-700" />
              Modifier <span className="font-mono text-sm">{code.code}</span>
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isFromFirst
                ? isPending
                  ? "Mode activation à la 1ère utilisation (pas encore utilisé)"
                  : "Mode activation — code déjà activé"
                : "Mode date fixe absolue"}
            </p>
          </div>

          {/* === Section 1 : extension rapide / nouvelle date === */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs font-bold uppercase tracking-wide flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {isPending ? "Modifier la durée d'activation" : "Prolonger la validité"}
            </Label>

            {isPending ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">jours</span>
                <Button
                  onClick={handleSetDuration}
                  disabled={saving}
                  size="sm"
                  className="bg-caf-green text-caf-green-foreground"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  OK
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {[1, 7, 14, 30, 60, 90, 180, 365].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={saving}
                      onClick={() => handleQuickExtend(n)}
                      className="text-xs px-2 py-1 rounded border-2 border-black bg-yellow-200 hover:bg-yellow-300 font-bold transition-colors disabled:opacity-50"
                    >
                      +{n}j
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Repart de l'expiration courante (ou de maintenant si déjà expiré).
                </p>
              </>
            )}
          </div>

          {/* === Section 2 : date d'expiration absolue === */}
          {!isPending && (
            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs font-bold uppercase tracking-wide">
                Définir une date d'expiration précise
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={handleSetExpiry}
                  disabled={saving || !newExpiry}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  OK
                </Button>
              </div>
            </div>
          )}

          {/* === Section 3 : libellé + quota === */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs font-bold uppercase tracking-wide flex items-center gap-1">
              <Tag className="h-3 w-3" /> Libellé & quota
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Libellé"
            />
            <div className="flex items-center gap-2">
              <Hash className="h-3 w-3 text-muted-foreground" />
              <Input
                type="number"
                min="0"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Utilisations max (0 = illimité)"
                className="flex-1"
              />
              <Button
                onClick={handleMeta}
                disabled={saving}
                size="sm"
                variant="outline"
              >
                {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground italic border-t pt-2">
            Utilisations actuelles : {code.usedCount}{code.maxUses > 0 ? ` / ${code.maxUses}` : " (illimité)"}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};

