"use client";

import { useEffect, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";

// Proxy Next.js → Railway (voir next.config.js)
const API = "/api";
const POLL_INTERVAL_MS = 60_000; // 60 secondes
const STORAGE_KEY = "wague-pmu-auth";

const REASON_MESSAGES = {
  inactive: "Ton accès a été désactivé par l'administrateur.",
  not_found: "Ton code d'accès n'existe plus.",
  expired: "Ton accès a expiré.",
  quota_exceeded: "Ton quota d'utilisations est atteint.",
};

/**
 * Hook qui vérifie périodiquement la validité du code utilisateur.
 *
 * - Polling toutes les 60s côté serveur
 * - Vérification immédiate au montage + au retour de focus de l'onglet
 * - Si le code est invalide (désactivé / supprimé / expiré) :
 *    - Vide le sessionStorage
 *    - Affiche un toast explicatif
 *    - Recharge la page pour repasser par le PasswordGate
 *
 * Usage : appeler `useCodeWatchdog(code)` dans le composant racine quand l'utilisateur est connecté.
 */
export function useCodeWatchdog(code) {
  const intervalRef = useRef(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!code) return undefined;

    const performLogout = (reason) => {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
      const msg = REASON_MESSAGES[reason] || "Ton accès n'est plus valide.";
      toast.error(msg, {
        description: "Tu vas être redirigé vers la page d'accueil.",
        duration: 4000,
      });
      // Délai pour que le toast s'affiche, puis full reload
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    };

    const checkOnce = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const { data } = await axios.post(
          `${API}/auth/check-code`,
          { code },
          { timeout: 10000 }
        );
        if (data && data.valid === false) {
          // Stop le polling avant le logout
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          performLogout(data.reason || "inactive");
        }
      } catch (e) {
        // En cas d'erreur réseau, on ne déconnecte PAS (évite faux positifs si backend offline temporairement)
        // Log silencieux uniquement
        if (process.env.NODE_ENV === "development") {
          console.warn("[useCodeWatchdog] check failed:", e?.message || e);
        }
      } finally {
        checkingRef.current = false;
      }
    };

    // 1) Vérification immédiate
    checkOnce();

    // 2) Polling régulier
    intervalRef.current = setInterval(checkOnce, POLL_INTERVAL_MS);

    // 3) Re-check quand l'onglet revient au premier plan (utilisateur revient après une pause)
    const onVisibility = () => {
      if (!document.hidden) checkOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkOnce);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkOnce);
    };
  }, [code]);
}

export default useCodeWatchdog;

