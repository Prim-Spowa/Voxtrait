import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportForm } from "../ImportForm";
import type { ImportJobView } from "@/lib/importClient";

// ST 9.5 — tests de composant du formulaire d'import : validation, blocage
// sans certification, parcours complet (URL signée → upload → finalisation →
// polling), et gestion des erreurs à chaque étape. `fetch` et le
// planificateur de poll sont injectés (mêmes conventions que
// `DoublageExport` / `DemandeRetraitForm`).
//
// Le planificateur injecté ignore le délai calculé
// (`computeNextImportPollDelayMs`, testé séparément) et rappelle
// immédiatement via `setTimeout(cb, 0)` : le polling progresse tout seul, on
// observe le résultat avec `waitFor`.
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

function makeFile(name = "ma-scene.mp4", type = "video/mp4", sizeBytes = 2000) {
  return new File(["x".repeat(sizeBytes)], name, { type });
}

async function remplirChampsValides() {
  await userEvent.upload(screen.getByLabelText(/Fichier vidéo/i), makeFile());
  await userEvent.clear(screen.getByLabelText(/^Titre$/i));
  await userEvent.type(screen.getByLabelText(/^Titre$/i), "Ma scène finale");
  await userEvent.click(screen.getByLabelText(new RegExp("certifie disposer des droits", "i")));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportForm", () => {
  it("bloque la soumission sans fichier sélectionné", async () => {
    const fetchImpl = vi.fn();
    render(<ImportForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Choisissez un fichier/i);
  });

  it("bloque la soumission tant que la certification des droits n'est pas cochée", async () => {
    const fetchImpl = vi.fn();
    render(<ImportForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await userEvent.upload(screen.getByLabelText(/Fichier vidéo/i), makeFile());
    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      screen.getByText(/certifier vos droits/i, { selector: "p[role='alert']" })
    ).toBeInTheDocument();
  });

  it("suggère un titre à partir du nom de fichier", async () => {
    render(<ImportForm fetchImpl={vi.fn() as unknown as typeof fetch} />);
    await userEvent.upload(screen.getByLabelText(/Fichier vidéo/i), makeFile("ma_scene_finale.mp4"));
    expect(screen.getByLabelText(/^Titre$/i)).toHaveValue("ma scene finale");
  });

  it("déroule le parcours complet jusqu'à l'extrait prêt", async () => {
    const job: ImportJobView = { id: "job-1", status: "en_attente", progress: 0 };
    const fetchImpl = vi
      .fn()
      // 1. POST /api/import/upload-url
      .mockResolvedValueOnce(
        jsonResponse({
          upload: {
            uploadUrl: "/api/media/upload/obj-1?sig=x&exp=1",
            method: "PUT",
            headers: { "Content-Type": "video/mp4" },
            objectRef: "obj-1",
            expiresAt: new Date().toISOString(),
          },
        })
      )
      // 2. PUT direct vers le stockage
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      // 3. POST /api/import
      .mockResolvedValueOnce(jsonResponse({ job }, { status: 202 }))
      // 4. GET /api/import/:id (en_traitement)
      .mockResolvedValueOnce(
        jsonResponse({ job: { id: "job-1", status: "en_traitement", progress: 0.5 } })
      )
      // 5. GET /api/import/:id (pret)
      .mockResolvedValue(
        jsonResponse({ job: { id: "job-1", status: "pret", progress: 1, extraitId: "extrait-1" } })
      );

    render(
      <ImportForm
        fetchImpl={fetchImpl as unknown as typeof fetch}
        schedulePoll={immediateSchedule}
      />
    );

    await remplirChampsValides();
    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    // Étape 1 : demande d'URL signée.
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/import/upload-url");
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).method).toBe("POST");

    await waitFor(() =>
      expect(screen.getByText(/en attente de modération/i)).toBeInTheDocument()
    , { timeout: 5000 });

    // Étape 2 : upload direct vers l'URL signée renvoyée à l'étape 1.
    expect(fetchImpl.mock.calls[1]![0]).toBe("/api/media/upload/obj-1?sig=x&exp=1");
    expect((fetchImpl.mock.calls[1]![1] as RequestInit).method).toBe("PUT");

    // Étape 3 : finalisation avec l'`objectRef` reçu.
    const finalizeInit = fetchImpl.mock.calls[2]![1] as RequestInit;
    expect(fetchImpl.mock.calls[2]![0]).toBe("/api/import");
    expect(JSON.parse(finalizeInit.body as string)).toMatchObject({
      objectRef: "obj-1",
      titre: "Ma scène finale",
      certifieDroits: true,
    });

    // Le polling s'est arrêté au statut terminal.
    const callsAfterReady = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl.mock.calls.length).toBe(callsAfterReady);
  });

  it("affiche l'erreur et n'uploade pas si la demande d'URL échoue (CGU non acceptées)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Vous devez accepter les conditions générales d'utilisation avant d'importer." },
          { ok: false, status: 403 }
        )
      );

    render(
      <ImportForm fetchImpl={fetchImpl as unknown as typeof fetch} schedulePoll={immediateSchedule} />
    );

    await remplirChampsValides();
    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/conditions générales/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("affiche l'erreur 422 si la vidéo est rejetée à la finalisation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          upload: {
            uploadUrl: "/api/media/upload/obj-2?sig=x&exp=1",
            method: "PUT",
            headers: {},
            objectRef: "obj-2",
            expiresAt: new Date().toISOString(),
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "La vidéo dépasse la durée maximale autorisée de 5 minutes." },
          { ok: false, status: 422 }
        )
      );

    render(
      <ImportForm fetchImpl={fetchImpl as unknown as typeof fetch} schedulePoll={immediateSchedule} />
    );

    await remplirChampsValides();
    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/durée maximale/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("affiche l'erreur si le job passe à echec pendant le polling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          upload: {
            uploadUrl: "/api/media/upload/obj-3?sig=x&exp=1",
            method: "PUT",
            headers: {},
            objectRef: "obj-3",
            expiresAt: new Date().toISOString(),
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ job: { id: "job-3", status: "en_attente", progress: 0 } }, { status: 202 })
      )
      .mockResolvedValue(
        jsonResponse({
          job: { id: "job-3", status: "echec", progress: 1, error: "La compression a échoué." },
        })
      );

    render(
      <ImportForm fetchImpl={fetchImpl as unknown as typeof fetch} schedulePoll={immediateSchedule} />
    );

    await remplirChampsValides();
    await userEvent.click(screen.getByRole("button", { name: /Importer cette vidéo/i }));

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
      /compression a échoué/i
    );
  });
});
