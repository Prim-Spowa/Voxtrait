import BibliothequeListing from "@/components/BibliothequeListing";

// ST 1.1 — page `/bibliotheque` : accessible sans compte (cf. US 1.1,
// "visiteur"), pas de garde d'authentification ici.
export const metadata = {
  title: "Bibliothèque d'extraits — Fandub",
  description:
    "Parcourez la bibliothèque d'extraits vidéo (films, séries, dessins animés) à redoubler.",
};

export default function BibliothequePage() {
  return (
    <main>
      <h1>Bibliothèque d&apos;extraits</h1>
      <BibliothequeListing />
    </main>
  );
}
