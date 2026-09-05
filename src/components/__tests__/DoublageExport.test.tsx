import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoublageExport } from "../DoublageExport";
import type { RecordingResult } from "../VoiceRecorder";
import type { DoublageJobView } from "@/lib/doublageClient";

// ST 3.1 — tests de composant : POST /api/doublages, polling, déclenchement du
// téléchargement, gestion d'erreur. `fetch` et le planificateur de poll sont
// injectés (mêmes conventions que `VoiceRecorder` / `VideoPlayer`).
//
// Le planificateur injecté ignore le délai calculé (`computeNextPollDelayMs`,
// testé séparément) et rappelle immédiatement via `setTimeout(cb, 0)` : le
// polling progresse tout seul, on observe le résultat avec `waitFor`.

function makeRecording(overrides: Partial<RecordingResult> = {}): RecordingResult {
  return {
    blob: new Blob(["x".repeat(2000)], { type: "audio/webm" }),
    mimeType: "audio/webm;codecs=opus",
    startedAtVideoTimeSeconds: 3,
    durationSeconds: 20,
    ...overrides,
  };
}

// Rappelle le callback de poll immédiatement (synchrone) : `poll` étant async
// et suspendu au premier `await fetch`, l'appel synchrone ne fait que lancer la
// promesse — pas de récursion de pile. Le délai calculé
// (`computeNextPollDelayMs`) est testé séparément.
const immediateSchedule = (cb: () => void): number => {
  cb();
  return 0;
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DoublageExport", () => {
  it("affiche un message tant qu'aucun enregistrement n'est disponible", () => {
    render(<DoublageExport extraitId="mock-002" extraitTitre="Réverbérations" recording={null} />);
    expect(screen.getByText(/Terminez un enregistrement/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("POST puis polling jusqu'à pret, et déclenche le téléchargement une seule fois", async () => {
    const ready: DoublageJobView = {
      id: "job-1",
      status: "pret",
      progress: 1,
      visibilite: "privee",
      downloadUrl: "/api/doublages/mock-download/x?sig=mock",
      downloadFilename: "reverberations-doublage.mp4",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ job: { id: "job-1", status: "en_attente", progress: 0 } }, { status: 202 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ job: { id: "job-1", status: "en_traitement", progress: 0.5 } })
      )
      .mockResolvedValue(jsonResponse({ job: ready }));

    const triggerDownload = vi.fn();

    render(
      <DoublageExport
        extraitId="mock-002"
        extraitTitre="Réverbérations"
        recording={makeRecording()}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
        triggerDownload={triggerDownload}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));

    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/doublages");
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe("POST");

    await waitFor(
      () => expect(screen.getByText(/votre doublage est prêt/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(triggerDownload).toHaveBeenCalledWith(ready.downloadUrl, ready.downloadFilename);

    // Le polling s'est bien arrêté : le nombre d'appels fetch se stabilise.
    const callsAfterReady = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl.mock.calls.length).toBe(callsAfterReady);
  });

  it("déclenche immédiatement le téléchargement si le POST renvoie déjà pret", async () => {
    const ready: DoublageJobView = {
      id: "job-2",
      status: "pret",
      progress: 1,
      visibilite: "privee",
      downloadUrl: "/dl/job-2",
      downloadFilename: "reverberations-doublage.mp4",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ job: ready }, { status: 202 }));
    const triggerDownload = vi.fn();

    render(
      <DoublageExport
        extraitId="mock-002"
        extraitTitre="Réverbérations"
        recording={makeRecording()}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
        triggerDownload={triggerDownload}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));

    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1); // aucun poll nécessaire
  });

  it("valide la requête côté client avant tout appel réseau", async () => {
    const fetchImpl = vi.fn();
    render(
      <DoublageExport
        extraitId="mock-002"
        extraitTitre="Réverbérations"
        recording={makeRecording({ durationSeconds: 100_000 })}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/5 minutes/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("affiche l'erreur serveur si le POST échoue", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "L'extrait de référence est introuvable." },
          { ok: false, status: 404 }
        )
      );

    render(
      <DoublageExport
        extraitId="inconnu"
        extraitTitre="X"
        recording={makeRecording()}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/introuvable/i);
  });

  it("affiche l'erreur si le job passe à echec pendant le polling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ job: { id: "j", status: "en_attente", progress: 0 } }, { status: 202 })
      )
      .mockResolvedValue(
        jsonResponse({
          job: {
            id: "j",
            status: "echec",
            progress: 1,
            error: "La génération du fichier de doublage a échoué.",
          },
        })
      );

    render(
      <DoublageExport
        extraitId="mock-002"
        extraitTitre="Réverbérations"
        recording={makeRecording()}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/échoué/i);
  });

  it("génère un lien de partage (ST 3.2) après un export réussi", async () => {
    const ready: DoublageJobView = {
      id: "job-9",
      status: "pret",
      progress: 1,
      visibilite: "privee",
      downloadUrl: "/dl/job-9",
      downloadFilename: "reverberations-doublage.mp4",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job: ready }, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            ...ready,
            visibilite: "lien_public",
            shareUrl: "https://voxtrait.test/doublage/job-9",
          },
        })
      );

    render(
      <DoublageExport
        extraitId="mock-002"
        extraitTitre="Réverbérations"
        recording={makeRecording()}
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
        triggerDownload={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
    const shareButton = await screen.findByRole("button", { name: /Partager ce doublage/i });
    await userEvent.click(shareButton);

    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/doublages/job-9/partage",
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findByTestId("doublage-share-buttons")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "X" })).toHaveAttribute(
      "href",
      expect.stringContaining("voxtrait.test%2Fdoublage%2Fjob-9")
    );
  });

  // ST 10.4 (tâche 3) — enchaînement avec la sauvegarde privée (ST 6.1).
  describe("sauvegarde privée (ST 6.1)", () => {
    const ready: DoublageJobView = {
      id: "job-42",
      status: "pret",
      progress: 1,
      visibilite: "privee",
      downloadUrl: "/dl/job-42",
      downloadFilename: "reverberations-doublage.mp4",
    };

    it("ne propose pas la sauvegarde à un visiteur non connecté", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ job: ready }, { status: 202 }));

      render(
        <DoublageExport
          extraitId="mock-002"
          extraitTitre="Réverbérations"
          recording={makeRecording()}
          connecte={false}
          fetchImpl={fetchImpl as unknown as typeof fetch}
          schedulePoll={immediateSchedule}
          triggerDownload={vi.fn()}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
      await screen.findByText(/votre doublage est prêt/i);
      expect(
        screen.queryByRole("button", { name: /Sauvegarder dans mon espace/i })
      ).not.toBeInTheDocument();
    });

    it("sauvegarde le doublage dans l'espace privé pour un compte connecté", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ job: ready }, { status: 202 }))
        .mockResolvedValueOnce(
          jsonResponse({ sauvegarde: { id: "sauvegarde-1" } }, { status: 201 })
        );

      render(
        <DoublageExport
          extraitId="mock-002"
          extraitTitre="Réverbérations"
          recording={makeRecording()}
          connecte
          fetchImpl={fetchImpl as unknown as typeof fetch}
          schedulePoll={immediateSchedule}
          triggerDownload={vi.fn()}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
      const sauvegarderButton = await screen.findByRole("button", {
        name: /Sauvegarder dans mon espace/i,
      });
      await userEvent.click(sauvegarderButton);

      expect(fetchImpl).toHaveBeenLastCalledWith(
        "/api/doublages/job-42/sauvegarder",
        expect.objectContaining({ method: "POST" })
      );
      expect(await screen.findByText(/sauvegardé en privé/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /voir mon espace/i })).toHaveAttribute(
        "href",
        "/mon-espace/historique"
      );
      expect(
        screen.queryByRole("button", { name: /Sauvegarder dans mon espace/i })
      ).not.toBeInTheDocument();
    });

    it("affiche l'erreur si la sauvegarde échoue", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ job: ready }, { status: 202 }))
        .mockResolvedValueOnce(
          jsonResponse({ error: "Doublage introuvable ou expiré." }, { ok: false, status: 404 })
        );

      render(
        <DoublageExport
          extraitId="mock-002"
          extraitTitre="Réverbérations"
          recording={makeRecording()}
          connecte
          fetchImpl={fetchImpl as unknown as typeof fetch}
          schedulePoll={immediateSchedule}
          triggerDownload={vi.fn()}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /Générer et télécharger/i }));
      const sauvegarderButton = await screen.findByRole("button", {
        name: /Sauvegarder dans mon espace/i,
      });
      await userEvent.click(sauvegarderButton);

      expect(await screen.findByRole("alert")).toHaveTextContent(/introuvable/i);
      // Le bouton reste disponible pour réessayer.
      expect(
        screen.getByRole("button", { name: /Sauvegarder dans mon espace/i })
      ).toBeInTheDocument();
    });
  });
});
