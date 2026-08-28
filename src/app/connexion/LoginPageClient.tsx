"use client";

import { useCallback } from "react";
import { LoginForm } from "@/components/LoginForm";
import { resolveSafeNext } from "@/lib/authGuard";

/**
 * Habillage client de la page `/connexion` — ST 4.2.
 *
 * Rôle : après une connexion réussie, renvoyer l'utilisateur là où il
 * voulait aller. La cible vient du paramètre `?next=` posé par le middleware
 * (`src/middleware.ts`) quand il a intercepté une route protégée ; elle est
 * repassée par `resolveSafeNext` (rejette les URL externes → anti-redirection
 * ouverte) avant d'être utilisée.
 *
 * `window.location.assign` (plutôt que le routeur Next) : on veut un
 * rechargement complet pour que les Server Components (TopBar, futures pages
 * `/mon-espace`) relisent le cookie de session fraîchement posé.
 */
export function LoginPageClient({ next }: { next?: string }) {
  const handleLoggedIn = useCallback(() => {
    const destination = resolveSafeNext(next);
    window.location.assign(destination);
  }, [next]);

  return <LoginForm onLoggedIn={handleLoggedIn} />;
}

export default LoginPageClient;
