import type { ReactNode } from "react";

export const metadata = {
  title: "Fandub — Plateforme communautaire de doublage",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
