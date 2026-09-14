
/**
 * Odds Detective — API helper.
 * Pointe vers `/api/odds/*` (router séparé du backend TURFEX).
 * Auth indépendante : token stocké en localStorage `cd_token`.
 */
import axios from "axios";

export const API = "/api/odds";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cd_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const formatDateAPI = (d) => {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}${month}${d.getFullYear()}`;
};

export const isoDate = (d) => {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

export const formatHeure = (ts) => {
  if (!ts) return "--:--";
  const dt = new Date(ts);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};

export const formatGains = (g) => {
  if (!g) return "—";
  const eur = g / 100;
  if (eur >= 1000) return `${Math.round(eur / 1000)}k€`;
  return `${eur}€`;
};

