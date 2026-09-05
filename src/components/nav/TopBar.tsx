"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useTheme } from "@/components/ui/useTheme";
import { LogoutButton } from "@/components/LogoutButton";
import type { UtilisateurPublic } from "@/lib/authClient";

/**
 * Port TypeScript de `components/nav/TopBar.jsx` (design system Doublure).
 *
 * Écarts assumés pour US 1.1 :
 * - La recherche n'est pas dans la barre : elle vit dans la colonne de filtres
 *   du listing, où elle est liée à l'état des résultats (un seul champ de
 *   recherche par écran).
 * - Pas d'avatar : la maquette prévoit un avatar de compte, non implémenté.
 *
 * ST 4.2 : la zone de droite reflète l'état de session, lu via
 * `GET /api/auth/session` au montage. Trois états : inconnu (rien affiché
 * pour éviter un clignotement « connecté → déconnecté »), anonyme (lien
 * « Se connecter »), connecté (`LogoutButton`).
 *
 * ST 10.1 : lien « Importer » (vers `/import`, ST 9.5) affiché uniquement à
 * l'état connecté, à côté du bouton thème. La route `/import` est déjà
 * protégée côté serveur par le middleware (ST 4.2, `PROTECTED_PREFIXES`) qui
 * redirige tout visiteur anonyme vers `/connexion?next=/import` — masquer le
 * lien ici n'est qu'une amélioration d'UX (évite l'aller-retour visible),
 * pas la ligne de défense.
 *
 * ST 10.2 : nom du compte connecté (`prénom nom`) affiché juste avant
 * `LogoutButton`. `nom`/`prenom` sont des chaînes non-nullables dans
 * `UtilisateurPublic`, mais les comptes créés avant ST 4.1 ont pu les
 * recevoir vides (`??  ""` côté serveur, cf. `toPublic` dans `lib/auth.ts`) :
 * repli sur l'e-mail du compte dans ce cas plutôt que d'afficher un bloc vide.
 *
 * ST 11.1 : la bascule de thème passe du bouton ad hoc (icône lune/soleil) au
 * composant `Switch` du design system, câblé sur `useTheme` — `data-theme` sur
 * `<html>` + persistance `localStorage`, partagés avec tous les écrans.
 */

const LINKS = [
  { id: "library", label: "Bibliothèque", href: "/bibliotheque" },
] as const;

/**
 * Nom à afficher pour un compte connecté : « prénom nom » si renseignés,
 * sinon repli sur l'e-mail (compte historique antérieur à ST 4.1).
 */
function nomAffiche(utilisateur: UtilisateurPublic): string {
  const complet = `${utilisateur.prenom} ${utilisateur.nom}`.trim();
  return complet || utilisateur.email;
}

/** État de session côté client : `undefined` tant que la requête n'a pas répondu. */
type SessionState = { status: "loading" } | { status: "anonymous" } | {
  status: "authenticated";
  utilisateur: UtilisateurPublic;
};

export interface TopBarProps {
  active?: (typeof LINKS)[number]["id"];
  /** `fetch` injectable pour les tests. */
  fetchImpl?: typeof fetch;
}

export function TopBar({ active = "library", fetchImpl }: TopBarProps) {
  // Thème « mode scène » : géré par `useTheme` (data-theme sur <html> +
  // persistance localStorage, partagé entre écrans).
  const { isDark, toggle } = useTheme();
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    const doFetch =
      fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
    if (!doFetch) return;
    let cancelled = false;

    doFetch("/api/auth/session", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : { utilisateur: null }))
      .then((data: { utilisateur?: UtilisateurPublic | null }) => {
        if (cancelled) return;
        setSession(
          data.utilisateur
            ? { status: "authenticated", utilisateur: data.utilisateur }
            : { status: "anonymous" }
        );
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "anonymous" });
      });

    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
        height: "var(--topbar-h)",
        padding: "0 var(--gutter-page)",
        background: "var(--surface-card)",
        borderBottom: "var(--border-hard)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <a
        href="/bibliotheque"
        style={{
          border: "none",
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          color: "var(--text-primary)",
        }}
      >
        {/* Pas de logo : la marque est le mot-type suivi d'un point néon. */}
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-title)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-display)",
          }}
        >
          Doublure
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "var(--radius-pill)",
            background: "var(--accent-primary)",
            boxShadow: "var(--glow-primary)",
          }}
        />
      </a>

      <nav aria-label="Navigation principale" style={{ display: "flex", gap: "var(--space-4)" }}>
        {LINKS.map((l) => (
          <a
            key={l.id}
            href={l.href}
            aria-current={active === l.id ? "page" : undefined}
            style={{
              padding: "4px 0",
              fontSize: "var(--text-body-sm)",
              fontWeight: "var(--weight-semibold)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              color: active === l.id ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active === l.id ? "inset 0 -3px 0 0 var(--accent-primary)" : "none",
              border: "none",
            }}
          >
            {l.label}
          </a>
        ))}
      </nav>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          marginLeft: "auto",
        }}
      >
        {session.status === "authenticated" && (
          <Button
            variant="ghost"
            size="sm"
            icon="upload"
            onClick={() => window.location.assign("/import")}
          >
            Importer
          </Button>
        )}
        <Switch checked={isDark} onChange={toggle} label="Mode scène" />
        {session.status === "authenticated" && (
          <span
            title={nomAffiche(session.utilisateur)}
            style={{
              maxWidth: 160,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--text-body-sm)",
              color: "var(--text-muted)",
            }}
          >
            {nomAffiche(session.utilisateur)}
          </span>
        )}
        {session.status === "authenticated" && <LogoutButton variant="ghost" size="sm" />}
        {session.status === "anonymous" && (
          <Button
            variant="primary"
            size="sm"
            icon="log-in"
            onClick={() => window.location.assign("/connexion")}
          >
            Se connecter
          </Button>
        )}
      </div>
    </header>
  );
}
