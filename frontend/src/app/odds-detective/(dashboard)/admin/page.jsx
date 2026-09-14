"use client";

import { useEffect, useState } from "react";
import { api } from "@/odds_detective/lib/api";
import PageHeader from "@/odds_detective/components/PageHeader";
import { toast } from "sonner";
import { Plus, Trash2, Shield, Key, Eye, EyeOff } from "lucide-react";
import { useOddsAuth } from "@/odds_detective/context/AuthContext";
;

export default function Admin() {
  const { user } = useOddsAuth();
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [expiration, setExpiration] = useState("25/09/2033");
  const [customCode, setCustomCode] = useState("");

  // Change admin code
  const [newAdminCode, setNewAdminCode] = useState("");
  const [confirmAdminCode, setConfirmAdminCode] = useState("");
  const [showAdminCode, setShowAdminCode] = useState(false);
  const [savingCode, setSavingCode] = useState(false);

  const load = () => api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!username.trim()) { toast.error("Username requis"); return; }
    try {
      const { data } = await api.post("/admin/users", {
        username: username.trim(),
        expiration: expiration.trim(),
        custom_code: customCode.trim() || undefined,
      });
      toast.success(`Code créé : ${data.code}`);
      setUsername(""); setCustomCode("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erreur");
    }
  };

  const remove = async (code) => {
    if (!window.confirm(`Supprimer le code ${code} ?`)) return;
    await api.delete(`/admin/users/${code}`);
    toast.success("Utilisateur supprimé");
    load();
  };

  const changeAdminCode = async () => {
    const a = newAdminCode.trim().toUpperCase();
    const b = confirmAdminCode.trim().toUpperCase();
    if (a.length < 4) { toast.error("Code trop court (min 4 caractères)"); return; }
    if (a !== b) { toast.error("Les deux codes ne correspondent pas"); return; }
    if (!/^[A-Z0-9]+$/.test(a)) { toast.error("Caractères alphanumériques uniquement"); return; }
    if (!window.confirm(
      `⚠️ Tu vas remplacer ton code admin actuel par "${a}".\n\n` +
      "Tu devras utiliser ce nouveau code pour te reconnecter à l'avenir.\n\nContinuer ?"
    )) return;
    setSavingCode(true);
    try {
      await api.post("/admin/change-code", { new_code: a, confirm: true });
      toast.success(`Code admin modifié → ${a}`);
      setNewAdminCode(""); setConfirmAdminCode("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erreur");
    } finally { setSavingCode(false); }
  };

  const adminUser = users.find((u) => u.is_admin) || {};

  return (
    <div className="fade-in">
      <PageHeader overline="Administration" title="Gestion des utilisateurs">
        <Shield className="text-[#FFD700]" size={24}/>
      </PageHeader>

      {/* Section : Modifier mon code admin */}
      <div className="px-8 pt-8">
        <div className="bg-[#121212] border border-[#FFD700]/30 rounded-sm p-5" data-testid="admin-change-code-panel">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-mono text-[11px] tracking-widest uppercase text-[#FFD700] mb-1 flex items-center gap-2">
                <Key size={13}/> // Modifier mon code admin
              </p>
              <p className="text-xs text-neutral-400">
                Code actuel : <span className="font-mono text-[#FFD700]">{adminUser.code || user.username || "—"}</span>
              </p>
              <p className="text-[11px] text-neutral-500 mt-1">
                Renseigne ton nouveau code (4-32 caractères alphanumériques majuscules) puis confirme. Tu seras reconnecté automatiquement.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="relative">
              <label className="block font-mono text-[10px] tracking-widest text-neutral-500 uppercase mb-1">Nouveau code</label>
              <input
                type={showAdminCode ? "text" : "password"}
                value={newAdminCode}
                onChange={(e) => setNewAdminCode(e.target.value.toUpperCase())}
                placeholder="ex: WAGUE2026"
                data-testid="admin-new-code-input"
                className="w-full bg-[#0A0A0A] border border-[#262626] rounded-sm px-3 py-2 pr-9 font-mono text-sm focus:outline-none focus:border-[#FFD700] uppercase tracking-widest"
              />
              <button
                type="button"
                onClick={() => setShowAdminCode((v) => !v)}
                className="absolute right-2 top-[28px] text-neutral-500 hover:text-[#FFD700]"
                title={showAdminCode ? "Masquer" : "Afficher"}
              >
                {showAdminCode ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            <div>
              <label className="block font-mono text-[10px] tracking-widest text-neutral-500 uppercase mb-1">Confirmer</label>
              <input
                type={showAdminCode ? "text" : "password"}
                value={confirmAdminCode}
                onChange={(e) => setConfirmAdminCode(e.target.value.toUpperCase())}
                placeholder="Ressaisir le code"
                data-testid="admin-confirm-code-input"
                className="w-full bg-[#0A0A0A] border border-[#262626] rounded-sm px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#FFD700] uppercase tracking-widest"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={changeAdminCode}
                disabled={savingCode || !newAdminCode || newAdminCode !== confirmAdminCode}
                data-testid="admin-change-code-btn"
                className="w-full bg-[#FFD700] text-black font-display font-bold tracking-wider px-4 py-2 rounded-sm hover:bg-[#e6c200] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Key size={14}/> {savingCode ? "ENREGISTREMENT..." : "MODIFIER"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-8 grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 bg-[#121212] border border-[#262626] rounded-sm p-5">
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#FFD700] mb-4">// Nouveau code utilisateur</p>
          <div className="space-y-3">
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (ex: jean)" data-testid="admin-username"
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-sm px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#FFD700]"/>
            <input value={customCode} onChange={(e) => setCustomCode(e.target.value)} placeholder="Code custom (optionnel)" data-testid="admin-custom-code"
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-sm px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#FFD700]"/>
            <input value={expiration} onChange={(e) => setExpiration(e.target.value)} placeholder="JJ/MM/AAAA" data-testid="admin-expiration"
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-sm px-3 py-2 font-mono text-sm focus:outline-none focus:border-[#FFD700]"/>
            <button onClick={create} data-testid="admin-create"
              className="w-full bg-[#FFD700] text-black font-display font-bold tracking-wider px-4 py-2 rounded-sm hover:bg-[#e6c200] flex items-center justify-center gap-2">
              <Plus size={14}/> CRÉER
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-[#121212] border border-[#262626] rounded-sm overflow-hidden" data-testid="admin-users-list">
          <div className="px-4 py-3 border-b border-[#262626]">
            <p className="font-mono text-[11px] tracking-widest uppercase text-[#FFD700]">// {users.length} utilisateur(s)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead className="bg-[#0A0A0A] border-b border-[#262626]">
                <tr className="text-[10px] uppercase tracking-widest text-neutral-400">
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Username</th>
                  <th className="text-left px-3 py-2">Expiration</th>
                  <th className="text-left px-3 py-2">Admin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.code} className="border-b border-[#1a1a1a] even:bg-white/[0.02]">
                    <td className="px-3 py-2 text-[#FFD700]">{u.code}</td>
                    <td className="px-3 py-2">{u.username}</td>
                    <td className="px-3 py-2 text-neutral-300">{u.expiration}</td>
                    <td className="px-3 py-2">{u.is_admin ? "✓" : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {!u.is_admin && (
                        <button onClick={() => remove(u.code)} className="text-[#FF3B30] hover:bg-[#FF3B30]/10 p-1 rounded-sm">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

