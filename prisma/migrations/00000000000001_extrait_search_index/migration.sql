-- Recherche texte sur `extraits.titre` (cf. ST 1.1 — "Ajouter l'indexation/recherche
-- texte (ex. pg_trgm ou recherche full-text Postgres)").
--
-- pg_trgm est utilisé plutôt qu'un index GIN full-text classique (to_tsvector) car il
-- supporte nativement la recherche "contains"/partielle (ILIKE '%terme%') sans nécessiter
-- de dictionnaire linguistique par langue — pertinent ici puisque les titres mélangent
-- français, anglais et japonais romanisé (cf. cahier des charges, catalogue FR/US/JP).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS extraits_titre_trgm_idx
  ON extraits
  USING GIN (titre gin_trgm_ops);
