
/**
 * TURF ASTRO — Helpers API + utilitaires.
 * Tous les endpoints sont préfixés `/api/astro/*` côté backend.
 */
import axios from "axios";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "https://turfex-backend-production.up.railway.app";
export const ASTRO_API = `${BACKEND_URL}/api/astro`;

export const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
};

export const parseDateKey = (key) => {
  const dd = parseInt(key.slice(0, 2), 10);
  const mm = parseInt(key.slice(2, 4), 10) - 1;
  const yyyy = parseInt(key.slice(4, 8), 10);
  return new Date(yyyy, mm, dd);
};

export const getProgramme = (dateKey) =>
  axios.get(`${ASTRO_API}/programme/${dateKey}`).then((r) => r.data);

export const getParticipants = (dateKey, r, c) =>
  axios.get(`${ASTRO_API}/race/${dateKey}/R${r}/C${c}/participants`).then((r2) => r2.data);

export const getNumerology = (dateKey, r, c) =>
  axios.get(`${ASTRO_API}/numerology/${dateKey}/R${r}/C${c}`).then((r2) => r2.data);

export const listFavorites = (dateKey) =>
  axios.get(`${ASTRO_API}/favorites${dateKey ? `?date=${dateKey}` : ""}`).then((r) => r.data);

export const addFavorite = (payload) =>
  axios.post(`${ASTRO_API}/favorites`, payload).then((r) => r.data);

export const removeFavorite = (id) =>
  axios.delete(`${ASTRO_API}/favorites/${id}`).then((r) => r.data);

export const formatTime = (ms) => {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

export const formatMontant = (cents) => {
  if (cents == null) return "—";
  const eur = Math.round(cents / 100);
  return new Intl.NumberFormat("fr-FR").format(eur) + " €";
};

