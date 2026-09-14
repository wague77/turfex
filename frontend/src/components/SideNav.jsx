"use client";

import { useState } from "react";
import {
  Zap,
  Sparkles,
  Calculator,
  Users,
  Brain,
  BarChart3,
  Trophy,
  Wallet,
  LineChart,
  Layers,
  Menu,
  X,
  LogOut,
  Clock,
  Eye,
  EyeOff,
  Target,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";

/**
 * Sidebar de navigation pour la page Index.
 *
 * Desktop : sidebar verticale sticky à gauche
 * Mobile : bouton hamburger + Sheet drawer
 *
 * Props :
 *  - value: tab actif (string)
 *  - onValueChange: (newTab) => void
 *  - horsesCount: nombre de partants (pour badge "Détail partants")
 */
export const TAB_ITEMS = [
  {
    value: "rapide",
    label: "Pronostic rapide",
    emoji: "⚡",
    icon: Zap,
    activeClass: "bg-gradient-to-r from-pink-500 to-violet-500 text-white",
  },
  {
    value: "coups",
    label: "Coups préparés",
    emoji: "🚨",
    icon: Sparkles,
    activeClass: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
  },
  {
    value: "caf",
    label: "Calculateur CAF",
    icon: Calculator,
    activeClass: "bg-caf-green text-caf-green-foreground",
  },
  {
    value: "detail",
    label: "Détail partants",
    icon: Users,
    activeClass: "bg-yellow-400 text-black",
    showCount: true,
  },
  {
    value: "analyse",
    label: "Analyse pro",
    icon: Brain,
    activeClass: "bg-emerald-400 text-emerald-950",
  },
  {
    value: "visu",
    label: "Visualisations",
    icon: BarChart3,
    activeClass: "bg-purple-400 text-purple-950",
  },
  {
    value: "strategie",
    label: "Stratégie & Jeux",
    icon: Trophy,
    activeClass: "bg-pink-400 text-pink-950",
  },
  {
    value: "carres",
    label: "Carrés magiques",
    icon: Layers,
    activeClass: "bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500 text-white",
  },
  {
    value: "intelligence",
    label: "TurfeX Intelligence",
    icon: Brain,
    activeClass: "bg-gradient-to-r from-amber-400 via-yellow-500 to-emerald-400 text-black",
  },
  {
    value: "ferran",
    label: "Méthode Ferran",
    icon: Brain,
    activeClass: "bg-gradient-to-r from-[#007AFF] via-cyan-500 to-emerald-400 text-white",
  },
  {
    value: "zones",
    label: "Zones Value",
    emoji: "💎",
    icon: Target,
    activeClass: "bg-gradient-to-r from-fuchsia-500 via-pink-500 to-orange-400 text-white",
  },
  {
    value: "astro",
    label: "Turf Astro",
    emoji: "✨",
    icon: Sparkles,
    activeClass: "bg-gradient-to-r from-emerald-900 via-emerald-700 to-amber-500 text-amber-50",
  },
  {
    value: "fortune",
    label: "Pari de la Fortune",
    emoji: "🎟️",
    icon: Ticket,
    activeClass: "bg-gradient-to-r from-[#0F4C3A] via-emerald-700 to-[#C9A227] text-white",
  },
];

const EXTERNAL_LINKS = [
  { to: "/paris", label: "Mes paris", icon: Wallet },
  { to: "/stats", label: "Stats", icon: LineChart },
];

const NavButton = ({ item, active, onClick, horsesCount }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`side-nav-${item.value}`}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold transition-all border-2 ${
        active
          ? `${item.activeClass} border-black shadow-md`
          : "bg-transparent text-white border-transparent hover:bg-white/10"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left truncate">
        {item.label}
        {item.emoji && <span className="ml-1">{item.emoji}</span>}
      </span>
      {item.showCount && horsesCount > 0 && (
        <span className="bg-row-pink text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
          {horsesCount}
        </span>
      )}
    </button>
  );
};

const formatRemainingTime = (iso) => {
  if (!iso) return null;
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "expiré";
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    if (days > 0) return `${days}j ${hours}h restants`;
    if (hours > 0) return `${hours}h ${totalMin % 60}m restants`;
    return `${totalMin}m restants`;
  } catch {
    return null;
  }
};

const NavList = ({ value, onValueChange, horsesCount, onItemClick, userInfo, onLogout }) => {
  const [codeRevealed, setCodeRevealed] = useState(false);
  const code = userInfo?.code || "";
  // Masque tout sauf les 4 derniers caractères (ex: ************-1A2B)
  const maskedCode = code.length > 4
    ? code.slice(0, -4).replace(/[A-Z0-9]/gi, "•") + code.slice(-4)
    : code.replace(/[A-Z0-9]/gi, "•");

  return (
  <nav className="flex flex-col gap-1 p-2" data-testid="side-nav-list">
    {TAB_ITEMS.map((item) => (
      <NavButton
        key={item.value}
        item={item}
        active={value === item.value}
        horsesCount={horsesCount}
        onClick={() => {
          onValueChange(item.value);
          onItemClick?.();
        }}
      />
    ))}
    <div className="mt-3 pt-3 border-t border-white/20">
      {EXTERNAL_LINKS.map((link) => {
        const Icon = link.icon;
        return (
          <a
            key={link.to}
            href={link.to}
            onClick={onItemClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-white/90 hover:bg-white/10 transition-all"
            data-testid={`side-nav-link-${link.to.replace("/", "")}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{link.label}</span>
          </a>
        );
      })}
    </div>

    {/* Footer : info utilisateur + bouton déconnexion */}
    {(userInfo?.code || onLogout) && (
      <div className="mt-3 pt-3 border-t border-white/20" data-testid="side-nav-footer">
        {userInfo?.code && (
          <div className="px-3 py-2 mb-1 bg-white/5 rounded-lg" data-testid="side-nav-user-info">
            <div className="text-[10px] uppercase tracking-wider text-white/50 mb-0.5 font-bold">
              Connecté avec
            </div>
            <div className="flex items-center gap-2">
              <div
                className="text-xs font-mono font-bold text-yellow-300 truncate flex-1"
                title={codeRevealed ? userInfo.code : "Code masqué — clique sur l'œil pour voir"}
                data-testid="side-nav-user-code"
              >
                {codeRevealed ? userInfo.code : maskedCode}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCodeRevealed((v) => !v);
                }}
                className="shrink-0 p-1 rounded hover:bg-white/10 text-white/70 hover:text-yellow-300 transition-colors"
                data-testid="side-nav-toggle-code-visibility"
                aria-label={codeRevealed ? "Masquer le code" : "Voir le code"}
                title={codeRevealed ? "Masquer le code" : "Voir le code"}
              >
                {codeRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {userInfo.expiresAt && (
              <div className="flex items-center gap-1 text-[10px] text-white/70 mt-1">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="truncate">{formatRemainingTime(userInfo.expiresAt)}</span>
              </div>
            )}
          </div>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={() => {
              onLogout();
              onItemClick?.();
            }}
            data-testid="side-nav-logout-btn"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-white/90 hover:bg-red-500/20 hover:text-red-200 border-2 border-transparent hover:border-red-400/40 transition-all"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Déconnexion</span>
          </button>
        )}
      </div>
    )}
  </nav>
  );
};

export const SideNav = ({ value, onValueChange, horsesCount = 0, userInfo, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:block lg:w-60 lg:shrink-0"
        data-testid="side-nav-desktop"
      >
        <div className="sticky top-4 bg-black border-2 border-black rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-400 text-black font-black text-xs uppercase tracking-wider">
            Navigation
          </div>
          <NavList
            value={value}
            onValueChange={onValueChange}
            horsesCount={horsesCount}
            userInfo={userInfo}
            onLogout={onLogout}
          />
        </div>
      </aside>

      {/* Mobile : hamburger + Sheet */}
      <div className="lg:hidden mb-3">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className="bg-black text-white border-2 border-black hover:bg-black/80 w-full justify-start gap-2 font-bold"
              data-testid="side-nav-mobile-toggle"
            >
              <Menu className="h-4 w-4" />
              Menu · {TAB_ITEMS.find((i) => i.value === value)?.label || "Navigation"}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="bg-black border-r-2 border-black p-0 w-64"
            data-testid="side-nav-mobile-sheet"
          >
            <SheetTitle className="sr-only">Navigation TURFEX</SheetTitle>
            <SheetDescription className="sr-only">
              Menu principal avec les 7 onglets d'analyse et les liens vers Mes paris et Stats.
            </SheetDescription>
            <div className="px-3 py-3 bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-400 text-black font-black text-sm uppercase tracking-wider flex items-center justify-between">
              <span>Navigation</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="text-black hover:bg-black/10 rounded p-1"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavList
              value={value}
              onValueChange={onValueChange}
              horsesCount={horsesCount}
              onItemClick={() => setMobileOpen(false)}
              userInfo={userInfo}
              onLogout={onLogout}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
};

export default SideNav;

