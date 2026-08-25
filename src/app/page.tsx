import { redirect } from "next/navigation";

/**
 * Route racine (`/`) — aucune page d'accueil dédiée n'est prévue à ce stade
 * du projet (cf. cahier des charges), la bibliothèque (`/bibliotheque`, ST
 * 1.1) est le point d'entrée fonctionnel de l'application. On y redirige
 * donc systématiquement plutôt que de laisser `/` renvoyer un 404.
 */
export default function RootPage() {
  redirect("/bibliotheque");
}
