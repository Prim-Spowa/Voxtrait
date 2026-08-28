"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordField } from "@/components/ui/PasswordField";
import {
  collectLoginErrors,
  LOGIN_GENERIC_ERROR,
  type LoginFieldErrors,
  type UtilisateurPublic,
} from "@/lib/authClient";

/**
 * Formulaire de connexion — ST 4.2 « Connexion / déconnexion » (US 4.2 : me
 * connecter). Pendant de `RegisterForm` (ST 4.1).
 *
 * Flux : validation locale minimale (présence des deux champs,
 * `collectLoginErrors`) → `POST /api/auth/login` → sur `200`, le cookie de
 * session est déjà posé par le serveur, on notifie le parent (`onLoggedIn`)
 * qui décide de la redirection.
 *
 * Messages d'erreur :
 *  - `401` → message **global générique** (`LOGIN_GENERIC_ERROR`) : on ne
 *    précise jamais si c'est l'e-mail ou le mot de passe (anti-énumération) ;
 *  - `403` → message global (compte suspendu) ;
 *  - `429` → message global (trop de tentatives).
 *
 * Point d'injection pour les tests (même convention que `RegisterForm`) :
 * `fetchImpl`.
 */
export interface LoginFormProps {
  style?: CSSProperties;
  /** `fetch` injectable — défaut : `window.fetch`. */
  fetchImpl?: typeof fetch;
  /** Appelé après une connexion réussie. */
  onLoggedIn?: (utilisateur: UtilisateurPublic) => void;
}

type Status = "idle" | "submitting" | "error";

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
  maxWidth: 420,
};

interface ApiErrorBody {
  error?: string;
}

export function LoginForm({ style, fetchImpl, onLoggedIn }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const validate = useCallback((): boolean => {
    const errors = collectLoginErrors({ email, password });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [email, password]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setGlobalError(null);

      if (!validate() || !doFetch) return;

      setStatus("submitting");
      try {
        const res = await doFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
          utilisateur?: UtilisateurPublic;
        };

        if (res.status === 200 && data.utilisateur) {
          onLoggedIn?.(data.utilisateur);
          return;
        }

        if (res.status === 401) {
          setGlobalError(LOGIN_GENERIC_ERROR);
        } else if (res.status === 403) {
          setGlobalError(data.error ?? "Ce compte a été suspendu.");
        } else if (res.status === 429) {
          setGlobalError(
            data.error ?? "Trop de tentatives de connexion. Réessayez dans quelques minutes."
          );
        } else {
          setGlobalError(data.error ?? `La connexion a échoué (${res.status}).`);
        }
        setStatus("error");
      } catch {
        setStatus("error");
        setGlobalError("Impossible de contacter le serveur. Vérifiez votre connexion.");
      }
    },
    [validate, doFetch, email, password, onLoggedIn]
  );

  return (
    <form
      style={{ ...CARD_STYLE, ...style }}
      data-testid="login-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <h1 style={{ margin: 0, fontSize: "var(--text-title)" }}>Se connecter</h1>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body-sm)" }}>
        Connectez-vous pour retrouver vos doublages sauvegardés. Aucun compte n&apos;est nécessaire
        pour doubler, télécharger ou partager.
      </p>

      <Input
        id="login-email"
        label="Adresse e-mail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
      />

      <PasswordField
        id="login-password"
        label="Mot de passe"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        autoComplete="current-password"
      />

      {globalError && (
        <p
          role="alert"
          style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-body-sm)" }}
        >
          {globalError}
        </p>
      )}

      <Button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Connexion…" : "Me connecter"}
      </Button>

      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
        Pas encore de compte ?{" "}
        <a href="/inscription" style={{ fontWeight: "var(--weight-semibold)" }}>
          Créer un compte
        </a>
      </p>
    </form>
  );
}

export default LoginForm;
