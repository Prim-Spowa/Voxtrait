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
  collectRegistrationErrors,
  PASSWORD_MIN_LENGTH,
  RGPD_NOTICE,
  type RegistrationFieldErrors,
  type UtilisateurPublic,
} from "@/lib/authClient";
import { CGU_CASE_LABEL } from "@/lib/cgu";

/**
 * Formulaire d'inscription — ST 4.1 « Inscription », découpage en tâches
 * point 3 : « Formulaire frontend avec messages d'erreur explicites ».
 *
 * Flux : validation locale (`collectRegistrationErrors`, règles partagées
 * avec le serveur) → `POST /api/auth/register` → sur `201`, le cookie de
 * session est déjà posé par le serveur, on notifie le parent (`onRegistered`)
 * qui décide de la redirection.
 *
 * Messages d'erreur explicites (US 4.1, critère d'acceptation « un message
 * m'indique lequel [champ] et pourquoi ») :
 *  - par champ, sous le champ concerné (format e-mail, robustesse mot de
 *    passe, confirmation) ;
 *  - `409` → erreur rattachée au champ e-mail (« déjà utilisé ») ;
 *  - `429` → message global (trop de tentatives).
 *
 * Point d'injection pour les tests (même convention que `DoublageExport`,
 * `VoiceRecorder`) : `fetchImpl`.
 */
export interface RegisterFormProps {
  style?: CSSProperties;
  /** `fetch` injectable — défaut : `window.fetch`. */
  fetchImpl?: typeof fetch;
  /** Appelé après une inscription réussie (compte + session créés). */
  onRegistered?: (utilisateur: UtilisateurPublic) => void;
}

type Status = "idle" | "submitting" | "success" | "error";

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
  fieldErrors?: Record<string, string>;
}

export function RegisterForm({ style, fetchImpl, onRegistered }: RegisterFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // ST 4.3 — case d'acceptation des CGU, obligatoire pour créer un compte.
  const [accepteCgu, setAccepteCgu] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors & { confirmation?: string }>(
    {}
  );
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const validate = useCallback((): boolean => {
    const errors: RegistrationFieldErrors & { confirmation?: string } = collectRegistrationErrors({
      email,
      password,
      accepteCgu,
    });
    if (password && confirmation !== password) {
      errors.confirmation = "Les deux mots de passe ne correspondent pas.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [email, password, confirmation, accepteCgu]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setGlobalError(null);

      if (!validate() || !doFetch) return;

      setStatus("submitting");
      try {
        const res = await doFetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: email.trim(), password, accepteCgu }),
        });
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody & {
          utilisateur?: UtilisateurPublic;
        };

        if (res.status === 201 && data.utilisateur) {
          setStatus("success");
          setCreatedEmail(data.utilisateur.email);
          onRegistered?.(data.utilisateur);
          return;
        }

        if (res.status === 409) {
          setFieldErrors({ email: data.error ?? "Cette adresse e-mail est déjà utilisée." });
        } else if (res.status === 400 && data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
        } else if (res.status === 429) {
          setGlobalError(
            data.error ?? "Trop de tentatives d'inscription. Réessayez dans quelques minutes."
          );
        } else {
          setGlobalError(data.error ?? `La création du compte a échoué (${res.status}).`);
        }
        setStatus("error");
      } catch {
        setStatus("error");
        setGlobalError("Impossible de contacter le serveur. Vérifiez votre connexion.");
      }
    },
    [validate, doFetch, email, password, accepteCgu, onRegistered]
  );

  if (status === "success") {
    return (
      <div style={{ ...CARD_STYLE, ...style }} data-testid="register-form">
        <h1 style={{ margin: 0, fontSize: "var(--text-title)" }}>Compte créé</h1>
        <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>
          Votre compte <strong>{createdEmail}</strong> est prêt et vous êtes connecté·e.
        </p>
        <a href="/bibliotheque" style={{ fontWeight: "var(--weight-semibold)" }}>
          Aller à la bibliothèque
        </a>
      </div>
    );
  }

  return (
    <form
      style={{ ...CARD_STYLE, ...style }}
      data-testid="register-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <h1 style={{ margin: 0, fontSize: "var(--text-title)" }}>Créer un compte</h1>
      <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-body-sm)" }}>
        Un compte permet de sauvegarder vos doublages et de les retrouver plus tard. Il n&apos;est
        pas nécessaire pour doubler, télécharger ou partager.
      </p>

      <Input
        id="register-email"
        label="Adresse e-mail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
      />

      <Input
        id="register-password"
        label="Mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        hint={`Au moins ${PASSWORD_MIN_LENGTH} caractères, combinant plusieurs types de caractères.`}
      />

      <PasswordField
        id="register-password-confirm"
        label="Confirmer le mot de passe"
        value={confirmation}
        onChange={setConfirmation}
        error={fieldErrors.confirmation}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", fontSize: "var(--text-body-sm)" }}>
          <input
            type="checkbox"
            checked={accepteCgu}
            onChange={(e) => setAccepteCgu(e.target.checked)}
            aria-invalid={fieldErrors.cgu ? true : undefined}
            style={{ marginTop: "0.2em" }}
          />
          <span>
            {CGU_CASE_LABEL}{" "}
            <a href="/cgu" target="_blank" rel="noopener noreferrer">
              Lire les CGU
            </a>
          </span>
        </label>
        {fieldErrors.cgu && (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-body-sm)" }}>
            {fieldErrors.cgu}
          </p>
        )}
      </div>

      {globalError && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-body-sm)" }}>
          {globalError}
        </p>
      )}

      <Button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Création…" : "Créer mon compte"}
      </Button>

      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
        {RGPD_NOTICE}
      </p>
    </form>
  );
}

export default RegisterForm;
