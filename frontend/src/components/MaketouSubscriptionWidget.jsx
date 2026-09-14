"use client";

/**
 * MaketouSubscriptionWidget — 3 plans tarifaires TURFEX via passerelle Maketou.
 *
 * Affiche les cartes Mensuel / Trimestriel / Annuel. À la sélection,
 * collecte prénom/nom/email puis crée un panier Maketou via le backend
 * (`POST /api/payment/maketou/checkout`) et redirige l'utilisateur vers
 * l'URL de paiement retournée. Le retour s'effectue sur `/payment-success`
 * qui poll le statut et révèle le code d'accès une fois le paiement validé.
 */
import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Sparkles, ShieldCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const PLANS = [
  {
    key: "1m",
    label: "1 mois",
    price: 30,
    oldPrice: null,
    monthly: 30.0,
    badge: null,
    accent: "from-zinc-500 to-zinc-700",
    border: "border-zinc-400",
  },
  {
    key: "3m",
    label: "3 mois",
    price: 80,
    oldPrice: 90,
    monthly: 26.67,
    badge: "Économie 10 €",
    accent: "from-amber-400 to-orange-500",
    border: "border-amber-400",
    popular: true,
  },
  {
    key: "1y",
    label: "1 an",
    price: 260,
    oldPrice: 360,
    monthly: 21.67,
    badge: "Économie 100 €",
    accent: "from-emerald-400 to-cyan-500",
    border: "border-emerald-400",
    bestValue: true,
  },
];

export const MaketouSubscriptionWidget = ({ defaultEmail = "" }) => {
  const [selected, setSelected] = useState(null); // plan key
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);

  const openPlan = (planKey) => {
    setSelected(planKey);
    setOpen(true);
  };

  const handleCheckout = async () => {
    const e = email.trim().toLowerCase();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Prénom et nom obligatoires");
      return;
    }
    if (!e || !e.includes("@") || !e.split("@")[1]?.includes(".")) {
      toast.error("Email invalide");
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/payment/maketou/checkout`, {
        plan: selected,
        email: e,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      if (data?.ok && data?.redirectUrl) {
        // Mémorise le cartId localement pour la page /payment-success
        try {
          sessionStorage.setItem(
            "turfex-maketou-cart",
            JSON.stringify({
              cartId: data.cartId,
              plan: selected,
              email: e,
              startedAt: new Date().toISOString(),
            })
          );
        } catch (_) {}
        // Redirige vers le checkout Maketou (Moneroo)
        window.location.href = data.redirectUrl;
      } else {
        toast.error("Création du paiement impossible", { description: "Réessayez dans un instant." });
      }
    } catch (err) {
      toast.error("Erreur paiement", {
        description: err?.response?.data?.detail || err?.message || "Inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  const sel = PLANS.find((p) => p.key === selected);

  return (
    <div className="w-full" data-testid="maketou-subscription-widget">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {PLANS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => openPlan(p.key)}
            data-testid={`maketou-plan-${p.key}`}
            className={`group relative text-left bg-card/95 backdrop-blur-sm border-2 ${p.border} rounded-xl p-3 hover:scale-[1.03] hover:shadow-xl transition-all duration-200 ${
              p.popular ? "ring-2 ring-amber-400/50" : ""
            } ${p.bestValue ? "ring-2 ring-emerald-400/50" : ""}`}
          >
            {p.badge && (
              <div
                className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black tracking-wider uppercase px-2 py-0.5 rounded-full bg-gradient-to-r ${p.accent} text-white shadow-md whitespace-nowrap`}
              >
                {p.badge}
              </div>
            )}
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">{p.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-foreground tracking-tight">{p.price} €</span>
              {p.oldPrice && (
                <span className="text-[11px] text-muted-foreground line-through font-semibold">
                  {p.oldPrice} €
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">soit {p.monthly.toFixed(2)} €/mois</div>
            <div
              className={`mt-2 inline-flex items-center gap-1 text-[10px] font-bold bg-gradient-to-r ${p.accent} bg-clip-text text-transparent group-hover:gap-2 transition-all`}
            >
              Choisir <ArrowRight className="h-3 w-3 text-foreground/60" />
            </div>
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground text-center mt-3 italic flex items-center justify-center gap-1.5">
        <ShieldCheck className="h-3 w-3 text-emerald-500" />
        Paiement sécurisé via Maketou • Code envoyé par email après paiement
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="maketou-checkout-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Abonnement TURFEX · {sel?.label}
            </DialogTitle>
            <DialogDescription>
              Total <span className="font-bold text-foreground">{sel?.price} €</span>
              {sel?.oldPrice && (
                <span className="ml-1 line-through text-xs">{sel.oldPrice} €</span>
              )}{" "}
              · payé en une fois via Maketou. Tu recevras ton code d'accès par email immédiatement après le paiement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                  Prénom
                </label>
                <Input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jean"
                  disabled={loading}
                  data-testid="maketou-firstname-input"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                  Nom
                </label>
                <Input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Dupont"
                  disabled={loading}
                  data-testid="maketou-lastname-input"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                Email · ton code y sera envoyé
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ton-email@example.com"
                disabled={loading}
                data-testid="maketou-email-input"
              />
            </div>
            <Button
              onClick={handleCheckout}
              disabled={loading || !firstName.trim() || !lastName.trim() || !email.trim()}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold disabled:opacity-50"
              data-testid="maketou-checkout-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Préparation du paiement…
                </>
              ) : (
                <>
                  Payer {sel?.price} € · Maketou
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center italic">
              Tu seras redirigé vers la page de paiement sécurisée Maketou.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MaketouSubscriptionWidget;

