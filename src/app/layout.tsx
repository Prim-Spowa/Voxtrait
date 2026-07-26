import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata = {
  title: "Doublure — Choisissez une scène, prenez le micro",
  description:
    "Bibliothèque d'extraits de films, séries et dessins animés à redoubler. Aucun compte n'est nécessaire pour doubler, télécharger ou partager.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
