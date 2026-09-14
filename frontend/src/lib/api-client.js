/**
 * URL de base de l'API backend.
 * On utilise un chemin relatif "/api" pour que le proxy Next.js
 * (configuré dans next.config.js via `rewrites`) achemine les requêtes
 * vers Railway, éliminant ainsi tout problème CORS.
 */
export const API = "/api";

/**
 * @deprecated Utilise plutôt `API` (chemin relatif via proxy Next.js).
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://turfex-backend-production.up.railway.app";
