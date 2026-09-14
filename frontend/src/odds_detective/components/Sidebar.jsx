"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOddsAuth } from "@/odds_detective/context/AuthContext";
import {
  Power, RefreshCw, TrendingUp, LayoutDashboard, ListChecks, FileSearch, Filter, LogOut, Shield,
} from "lucide-react";

const items = [
  { to: "/odds-detective/actualiser", label: "Actualiser", icon: RefreshCw, testid: "nav-actualiser" },
  { to: "/odds-detective/tendance", label: "Tendance jour", icon: TrendingUp, testid: "nav-tendance" },
  { to: "/odds-detective/tableau-de-bord", label: "Tableau de bord", icon: LayoutDashboard, testid: "nav-tableau-de-bord" },
  { to: "/odds-detective/programme", label: "Programme par course", icon: ListChecks, testid: "nav-programme" },
  { to: "/odds-detective/analyse", label: "Analyse", icon: FileSearch, testid: "nav-analyse" },
  { to: "/odds-detective/filtres", label: "Filtres et jeux", icon: Filter, testid: "nav-filtres" },
];

export default function Sidebar() {
  const { user, logout } = useOddsAuth();
  const router = useRouter();
  const pathname = usePathname();

  const linkClass = (to) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors ${
      pathname === to
        ? "bg-[#00FF66]/10 text-[#00FF66] border-l-2 border-[#00FF66] -ml-[2px] pl-[14px]"
        : "text-neutral-300 hover:bg-white/5"
    }`;

  return (
    <aside
      className="w-64 shrink-0 bg-[#0A0A0A] border-r border-[#262626] h-screen flex flex-col sticky top-0"
      data-testid="odds-sidebar"
    >
      <div className="p-5 border-b border-[#262626]">
        <span className="font-bold text-lg tracking-widest text-[#00FF66]">ODDS DÉTECTIVE</span>
      </div>

      <div className="px-3 py-2">
        <p className="font-mono text-[10px] tracking-widest text-neutral-500 px-2 py-2">// MENU</p>
        <button
          onClick={() => router.push("/odds-detective/tendance")}
          data-testid="nav-demarrer"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-neutral-300 hover:bg-white/5 transition-colors"
        >
          <Power size={15} className="text-[#00FF66]" />
          <span>Démarrer</span>
        </button>
        {items.map((it) => (
          <a
            key={it.to}
            href={it.to}
            data-testid={it.testid}
            className={linkClass(it.to)}
          >
            <it.icon size={15} />
            <span>{it.label}</span>
          </a>
        ))}
        <a
          href="/odds-detective/admin"
          data-testid="nav-admin"
          className={`mt-2 ${linkClass("/odds-detective/admin")} border-t border-[#262626] pt-4 ${
            pathname === "/odds-detective/admin" ? "text-[#FFD700]" : "text-[#FFD700]/70"
          }`}
        >
          <Shield size={15} />
          <span>Administration</span>
        </a>
      </div>

      <div className="mt-auto p-4 border-t border-[#262626]">
        <p className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest">Utilisateur</p>
        <p className="font-display font-medium text-sm truncate" data-testid="sidebar-username">
          {user?.username || "—"}
        </p>
        <p className="font-mono text-[10px] text-neutral-400">Exp. {user?.expiration}</p>
        <button
          onClick={() => { logout(); router.push("/odds-detective"); }}
          data-testid="logout-button"
          className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-neutral-400 hover:text-[#FF3B30] border border-[#262626] hover:border-[#FF3B30] py-2 rounded-sm transition-colors"
        >
          <LogOut size={13} /> Déconnexion
        </button>
      </div>
    </aside>
  );
}
