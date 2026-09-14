"use client";

/**
 * ResendDomainsPanel — gestion des domaines Resend depuis l'admin TURFEX.
 *
 * Permet à l'admin :
 *   - de lister les domaines enregistrés sur le compte Resend (avec leur statut)
 *   - d'ajouter un nouveau domaine (ex: royal-turf777.com)
 *   - de voir les enregistrements DNS (SPF/DKIM) à poser chez l'hébergeur
 *   - de déclencher la vérification DNS
 *   - de supprimer un domaine
 *
 * Tant qu'un domaine n'est pas "verified", Resend bloque tous les envois sauf
 * vers l'email du propriétaire du compte (limitation API).
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Copy,
} from "lucide-react";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";

const STATUS_META = {
  verified: { label: "VÉRIFIÉ", color: "emerald", icon: CheckCircle2 },
  pending: { label: "EN ATTENTE DNS", color: "amber", icon: Clock },
  failed: { label: "ÉCHEC", color: "red", icon: AlertTriangle },
  not_started: { label: "NON DÉMARRÉ", color: "gray", icon: Clock },
  temporary_failure: { label: "ÉCHEC TEMPORAIRE", color: "amber", icon: AlertTriangle },
};

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    toast.success("Copié", { description: text.slice(0, 60) + (text.length > 60 ? "…" : "") });
  }
}

function DnsRecordsTable({ records }) {
  if (!records || records.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">
        Aucun enregistrement DNS retourné par Resend pour ce domaine.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="resend-dns-records-table">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b-2 border-black">
            <th className="text-left p-2 font-bold">Type</th>
            <th className="text-left p-2 font-bold">Nom</th>
            <th className="text-left p-2 font-bold">Valeur</th>
            <th className="text-left p-2 font-bold w-20">Priorité / TTL</th>
            <th className="text-left p-2 font-bold w-24">Statut</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {records.map((rec, idx) => {
            const status = (rec.status || "").toLowerCase();
            const statusColor = status === "verified" ? "emerald" : status === "pending" || status === "not_started" ? "amber" : "red";
            return (
              <tr key={idx} className="border-b border-gray-200 align-top">
                <td className="p-2 font-mono font-bold">{rec.record || rec.type}</td>
                <td className="p-2 font-mono break-all">{rec.name}</td>
                <td className="p-2 font-mono break-all max-w-[280px]">{rec.value}</td>
                <td className="p-2 font-mono">
                  {rec.priority != null && <div>Pri: {rec.priority}</div>}
                  {rec.ttl != null && <div>TTL: {rec.ttl}</div>}
                </td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded bg-${statusColor}-100 text-${statusColor}-800 border border-${statusColor}-300`}>
                    {(rec.status || "—").toUpperCase()}
                  </span>
                </td>
                <td className="p-2">
                  <Button
                    onClick={() => copyToClipboard(rec.value)}
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    title="Copier la valeur"
                    data-testid={`dns-record-copy-${idx}`}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ResendDomainsPanel({ token }) {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [region, setRegion] = useState("eu-west-1");
  const [verifying, setVerifying] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [recordsCache, setRecordsCache] = useState({}); // domainId -> records[]
  const [fetchingRecords, setFetchingRecords] = useState(null);
  const [error, setError] = useState(null);

  const headers = { headers: { "X-Admin-Password": token } };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API}/admin/resend/domains`, headers);
      setDomains(data.domains || []);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "Erreur chargement";
      setError(msg);
      setDomains([]);
    } finally {
      setLoading(false);
    }
  };

  const loadRecords = async (domainId) => {
    setFetchingRecords(domainId);
    try {
      const { data } = await axios.get(`${API}/admin/resend/domains/${domainId}`, headers);
      const recs = data?.domain?.records || [];
      setRecordsCache((prev) => ({ ...prev, [domainId]: recs }));
    } catch (err) {
      toast.error("Erreur chargement DNS", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setFetchingRecords(null);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleAdd = async () => {
    const name = (newName || "").trim().toLowerCase();
    if (!name || !name.includes(".") || name.includes(" ")) {
      toast.error("Domaine invalide", { description: "Ex : royal-turf777.com" });
      return;
    }
    setAdding(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/resend/domains`,
        { name, region },
        headers
      );
      toast.success(`Domaine ajouté : ${name}`, {
        description: "Pose les enregistrements DNS puis clique 'Vérifier'.",
        duration: 8000,
      });
      setNewName("");
      // Auto-expand the newly created domain to show DNS records
      const newId = data?.domain?.id;
      if (newId) {
        setExpandedId(newId);
        // The create response includes records — cache them
        if (data.domain.records) {
          setRecordsCache((prev) => ({ ...prev, [newId]: data.domain.records }));
        }
      }
      await load();
    } catch (err) {
      toast.error("Ajout échoué", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setAdding(false);
    }
  };

  const handleVerify = async (domainId, name) => {
    setVerifying(domainId);
    try {
      await axios.post(`${API}/admin/resend/domains/${domainId}/verify`, {}, headers);
      toast.success(`Vérification déclenchée pour ${name}`, {
        description: "Resend va contrôler tes DNS dans les prochaines minutes.",
        duration: 8000,
      });
      // Reload list + records
      await load();
      await loadRecords(domainId);
    } catch (err) {
      toast.error("Vérification échouée", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setVerifying(null);
    }
  };

  const handleDelete = async (domainId, name) => {
    if (!window.confirm(`Supprimer le domaine "${name}" du compte Resend ?\n\nLes envois depuis ce domaine seront immédiatement bloqués.`)) return;
    setDeleting(domainId);
    try {
      await axios.delete(`${API}/admin/resend/domains/${domainId}`, headers);
      toast.success(`Domaine supprimé : ${name}`);
      setExpandedId(null);
      setRecordsCache((prev) => {
        const next = { ...prev };
        delete next[domainId];
        return next;
      });
      await load();
    } catch (err) {
      toast.error("Suppression échouée", {
        description: err?.response?.data?.detail || err?.message,
      });
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleExpand = async (domainId) => {
    if (expandedId === domainId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(domainId);
    if (!recordsCache[domainId]) {
      await loadRecords(domainId);
    }
  };

  return (
    <section
      className="max-w-6xl mx-auto bg-surface border-2 border-black rounded p-4 mb-6"
      data-testid="resend-domains-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <Globe className="h-5 w-5" />
        <h2 className="text-lg font-bold">Domaines vérifiés Resend</h2>
        <Button
          onClick={load}
          variant="outline"
          size="sm"
          className="ml-auto bg-white border-2 border-black"
          disabled={loading}
          data-testid="resend-domains-refresh-btn"
          title="Recharger"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="text-xs text-gray-600 mb-3 leading-relaxed">
        Tant qu'un domaine n'est pas <b>vérifié</b>, Resend bloque les envois aux tiers (seul l'email du propriétaire du compte fonctionne). Ajoute ton domaine ici, pose les enregistrements DNS chez ton hébergeur (OVH, Cloudflare, IONOS…), puis clique sur <b>Vérifier</b>.
      </div>

      {/* Formulaire ajout */}
      <div className="bg-white border border-gray-300 rounded p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-bold mb-1">Nouveau domaine</label>
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="ex : royal-turf777.com"
              className="font-mono"
              data-testid="resend-domain-new-input"
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-1">Région</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-9 px-2 border-2 border-black rounded bg-white text-sm"
              data-testid="resend-domain-region-select"
            >
              <option value="eu-west-1">eu-west-1 (Irlande)</option>
              <option value="us-east-1">us-east-1 (Virginie)</option>
              <option value="sa-east-1">sa-east-1 (Brésil)</option>
              <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
            </select>
          </div>
          <Button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            size="sm"
            className="h-9 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white border-2 border-black hover:opacity-90 disabled:opacity-50 font-bold"
            data-testid="resend-domain-add-btn"
          >
            {adding ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Ajouter
          </Button>
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="text-sm text-gray-600">Chargement…</div>
      ) : error ? (
        <div className="bg-red-50 border-2 border-red-300 rounded p-3 text-sm text-red-800" data-testid="resend-domains-error">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          {error}
        </div>
      ) : domains.length === 0 ? (
        <div className="text-sm text-gray-500 italic" data-testid="resend-domains-empty">
          Aucun domaine enregistré. Ajoute-en un ci-dessus pour permettre l'envoi à des destinataires tiers.
        </div>
      ) : (
        <div className="space-y-2">
          {domains.map((d) => {
            const meta = STATUS_META[d.status] || STATUS_META.pending;
            const Icon = meta.icon;
            const isExpanded = expandedId === d.id;
            const isVerified = d.status === "verified";
            const recs = recordsCache[d.id];
            return (
              <div
                key={d.id}
                className="bg-white border-2 border-black rounded p-3"
                data-testid={`resend-domain-row-${d.name}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Icon className={`h-5 w-5 text-${meta.color}-600 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm font-mono">{d.name}</div>
                    <div className="text-[11px] text-gray-500">
                      ID : <span className="font-mono">{d.id?.slice(0, 8)}…</span>
                      {d.region && <> · Région : <span className="font-mono">{d.region}</span></>}
                      {d.created_at && <> · Créé : {new Date(d.created_at).toLocaleDateString("fr-FR")}</>}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-[10px] font-bold rounded bg-${meta.color}-100 text-${meta.color}-800 border-2 border-${meta.color}-400`}
                    data-testid={`resend-domain-status-${d.name}`}
                  >
                    {meta.label}
                  </span>
                  <Button
                    onClick={() => handleToggleExpand(d.id)}
                    size="sm"
                    variant="outline"
                    className="bg-white border-2 border-black h-8"
                    data-testid={`resend-domain-toggle-${d.name}`}
                  >
                    {isExpanded ? "Masquer DNS" : "Voir DNS"}
                  </Button>
                  {!isVerified && (
                    <Button
                      onClick={() => handleVerify(d.id, d.name)}
                      disabled={verifying === d.id}
                      size="sm"
                      className="h-8 bg-violet-600 text-white border-2 border-black hover:bg-violet-700 font-bold"
                      data-testid={`resend-domain-verify-${d.name}`}
                    >
                      {verifying === d.id ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                      Vérifier
                    </Button>
                  )}
                  <Button
                    onClick={() => handleDelete(d.id, d.name)}
                    disabled={deleting === d.id}
                    size="sm"
                    variant="outline"
                    className="h-8 bg-white border-red-500 text-red-700 hover:bg-red-50"
                    data-testid={`resend-domain-delete-${d.name}`}
                    title="Supprimer ce domaine"
                  >
                    {deleting === d.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t-2 border-dashed border-gray-300">
                    {fetchingRecords === d.id && !recs ? (
                      <div className="text-xs text-gray-500 italic">Chargement des enregistrements DNS…</div>
                    ) : (
                      <DnsRecordsTable records={recs} />
                    )}
                    <div className="text-[11px] text-gray-600 mt-2 leading-relaxed">
                      ℹ️ Copie chaque ligne dans ta zone DNS (chez OVH/Cloudflare/IONOS/etc.). Une fois les 3 records posés, clique <b>Vérifier</b>. Resend valide en quelques minutes.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

