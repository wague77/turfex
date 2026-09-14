"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound, Eye, EyeOff, AlertTriangle, CheckCircle2 } from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";
const ADMIN_KEY = "wague-pmu-admin-token";

export const ChangePasswordDialog = ({ token, onPasswordChanged }) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setShow(false);
    setError("");
  };

  const handleOpenChange = (v) => {
    setOpen(v);
    if (!v) reset();
  };

  const strength = (() => {
    if (!next) return null;
    let score = 0;
    if (next.length >= 8) score++;
    if (next.length >= 12) score++;
    if (/[A-Z]/.test(next)) score++;
    if (/[0-9]/.test(next)) score++;
    if (/[^A-Za-z0-9]/.test(next)) score++;
    if (score <= 2) return { label: "Faible", color: "bg-red-500", text: "text-red-700" };
    if (score <= 3) return { label: "Moyen", color: "bg-yellow-500", text: "text-yellow-700" };
    if (score <= 4) return { label: "Bon", color: "bg-blue-500", text: "text-blue-700" };
    return { label: "Excellent", color: "bg-green-600", text: "text-green-700" };
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (next.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères");
      return;
    }
    if (next !== confirm) {
      setError("Les deux nouveaux mots de passe ne correspondent pas");
      return;
    }
    if (next === current) {
      setError("Le nouveau mot de passe doit être différent de l'actuel");
      return;
    }

    setLoading(true);
    try {
      const resp = await axios.post(
        `${API}/admin/change-password`,
        { currentPassword: current, newPassword: next },
        { headers: { "X-Admin-Password": token } }
      );
      const newToken = resp.data?.adminToken;
      if (newToken) {
        sessionStorage.setItem(ADMIN_KEY, newToken);
        onPasswordChanged?.(newToken);
      }
      toast.success("Mot de passe admin mis à jour", {
        description: "Ton nouveau mot de passe est actif immédiatement.",
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
      });
      setOpen(false);
      reset();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      let msg = "Erreur inconnue";
      if (typeof detail === "string") msg = detail;
      else if (detail?.error) msg = detail.error;
      else if (err?.message) msg = err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="bg-white border-2 border-black hover:bg-pink-100"
          data-testid="change-password-trigger-btn"
          title="Modifier le mot de passe administrateur"
        >
          <KeyRound className="h-4 w-4 mr-1" /> Mot de passe
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="change-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-row-pink" />
            Modifier le mot de passe admin
          </DialogTitle>
          <DialogDescription>
            Ton nouveau mot de passe sera stocké en base et prendra effet immédiatement.
            Il remplacera le mot de passe défini dans la configuration serveur.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="current-pwd" className="text-xs font-bold">
              Mot de passe actuel
            </Label>
            <Input
              id="current-pwd"
              type={show ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={loading}
              data-testid="change-password-current-input"
              required
            />
          </div>

          <div>
            <Label htmlFor="new-pwd" className="text-xs font-bold">
              Nouveau mot de passe{" "}
              <span className="font-normal text-muted-foreground">(8 caractères minimum)</span>
            </Label>
            <Input
              id="new-pwd"
              type={show ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              data-testid="change-password-new-input"
              required
              minLength={8}
            />
            {strength && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 bg-gray-200 rounded overflow-hidden">
                  <div
                    className={`h-full ${strength.color} transition-all`}
                    style={{
                      width:
                        strength.label === "Faible"
                          ? "25%"
                          : strength.label === "Moyen"
                          ? "50%"
                          : strength.label === "Bon"
                          ? "75%"
                          : "100%",
                    }}
                  />
                </div>
                <span className={`text-[11px] font-bold ${strength.text}`}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="confirm-pwd" className="text-xs font-bold">
              Confirmer le nouveau mot de passe
            </Label>
            <Input
              id="confirm-pwd"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              data-testid="change-password-confirm-input"
              required
              minLength={8}
            />
            {confirm && next && confirm !== next && (
              <p className="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            data-testid="change-password-toggle-visibility"
          >
            {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {show ? "Masquer" : "Afficher"} les mots de passe
          </button>

          {error && (
            <div
              className="text-sm bg-destructive/10 border border-destructive/30 text-destructive rounded px-3 py-2 flex items-start gap-2"
              data-testid="change-password-error"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
              data-testid="change-password-cancel-btn"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              className="bg-row-pink hover:bg-row-pink/90 text-white font-bold"
              disabled={loading || !current || !next || !confirm}
              data-testid="change-password-submit-btn"
            >
              {loading ? "Mise à jour..." : "Mettre à jour"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;

