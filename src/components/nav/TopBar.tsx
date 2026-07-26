"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Port TypeScript de `components/nav/TopBar.jsx` (design system Doublure).
 *
 * Écarts assumés pour US 1.1 :
 * - La recherche n'est pas dans la barre : elle vit dans la colonne de filtres
 *   du listing, où elle est liée à l'état des résultats (un seul champ de
 *   recherche par écran).
 * - Pas d'avatar : l'authentification est l'Epic 4. Le bouton « Se connecter »
 *   est affiché mais inerte, pour tenir la maquette sans simuler une session.
 */

const LINKS = [
  { id: "library", label: "Bibliothèque", href: "/bibliotheque" },
] as const;

export interface TopBarProps {
  active?: (typeof LINKS)[number]["id"];
}

export function TopBar({ active = "library" }: TopBarProps) {
  // Thème sombre (« mode scène ») : bascule locale, non persistée. La
  // persistance (préférence compte ou stockage local) relèvera d'une story
  // dédiée.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDark((d) => !d)}
          aria-label={dark ? "Thème clair" : "Mode scène"}
        >
          <Icon name={dark ? "sun" : "moon"} size={16} />
        </Button>
        <Button variant="primary" size="sm" icon="log-in" disabled>
          Se connecter
        </Button>
      </div>
    </header>
  );
}
