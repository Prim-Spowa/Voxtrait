"use client";

import { useCallback, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";

/**
 * Bouton de déconnexion — ST 4.2 « Connexion / déconnexion » (US 4.2 : me
 * déconnecter).
 *
 * `POST /api/auth/logout` (efface le cookie de session côté serveur) puis
 * rechargement complet vers `redirectTo` : les Server Components relisent
 * alors l'absence de session. En cas d'échec réseau on redirige quand même —
 * le cookie `httpOnly` n'est pas accessible en JS, mais l'utilisateur ne doit
 * pas rester bloqué ; la prochaine navigation retentera côté serveur.
 *
 * `fetchImpl` injectable pour les tests (même convention que `LoginForm`).
 */
export interface LogoutButtonProps {
  fetchImpl?: typeof fetch;
  redirectTo?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Redirection injectable pour les tests (défaut : `window.location.assign`). */
  onRedirect?: (url: string) => void;
}

export function LogoutButton({
  fetchImpl,
  redirectTo = "/bibliotheque",
  variant = "ghost",
  size = "sm",
  onRedirect,
}: LogoutButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    setBusy(true);
    const doFetch = fetchImpl ?? fetch.bind(globalThis);
    try {
      await doFetch("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
    } catch {
      // On redirige quand même (cf. docstring).
    }
    const redirect = onRedirect ?? ((url: string) => window.location.assign(url));
    redirect(redirectTo);
  }, [fetchImpl, redirectTo, onRedirect]);

  return (
    <Button variant={variant} size={size} icon="log-out" disabled={busy} onClick={handleClick}>
      {busy ? "Déconnexion…" : "Se déconnecter"}
    </Button>
  );
}

export default LogoutButton;
