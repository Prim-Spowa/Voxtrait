/**
 * Stockage temporaire du blob audio enregistré, le temps de la session
 * (ST 2.1, découpage en tâches, point 4 : "Stockage temporaire du blob audio
 * en mémoire/IndexedDB le temps de la session").
 *
 * Deux implémentations partagent l'interface `AudioBlobStore` :
 * - `createInMemoryAudioBlobStore` : un simple `Map`, perdu à l'actualisation
 *   de la page — implémentation par défaut si IndexedDB est indisponible,
 *   entièrement testable en isolation (aucune dépendance navigateur).
 * - `createIndexedDbAudioBlobStore` : persiste dans IndexedDB, survit à un
 *   rechargement accidentel de la page pendant la prévisualisation (avant
 *   tout envoi serveur, cf. ST 3.1).
 *
 * ⚠️ `createIndexedDbAudioBlobStore` n'est pas couverte par des tests
 * unitaires : elle repose sur l'API `indexedDB` du navigateur, absente de
 * l'environnement de test (jsdom) et sans polyfill dans les dépendances de ce
 * projet. Comportement à valider manuellement en navigateur réel — même
 * limite déjà assumée pour le mode embed de `VideoPlayer` (ST 1.2, horloge de
 * secours documentée comme hypothèse à valider). Voir notes de dev.
 */

export interface AudioBlobStore {
  save(id: string, blob: Blob): Promise<void>;
  load(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

/** Implémentation en mémoire — perdue à l'actualisation de la page, sans dépendance navigateur. */
export function createInMemoryAudioBlobStore(): AudioBlobStore {
  const store = new Map<string, Blob>();
  return {
    async save(id, blob) {
      store.set(id, blob);
    },
    async load(id) {
      return store.get(id) ?? null;
    },
    async remove(id) {
      store.delete(id);
    },
  };
}

const DB_NAME = "doublage-enregistrements";
const DB_VERSION = 1;
const STORE_NAME = "audio-blobs";

/**
 * `indexedDB` n'est disponible que côté navigateur (absent en rendu serveur
 * Next.js et en environnement de test) — à vérifier avant tout usage.
 */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Implémentation IndexedDB — cf. avertissement de test en tête de fichier. */
export function createIndexedDbAudioBlobStore(): AudioBlobStore {
  return {
    async save(id, blob) {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    async load(id) {
      const db = await openDatabase();
      const result = await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return result;
    },
    async remove(id) {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
  };
}

/**
 * Choisit IndexedDB si disponible, sinon repli en mémoire — c'est cette
 * fabrique par défaut que `VoiceRecorder` utilise si aucun `store` n'est
 * injecté (cf. `VoiceRecorderProps.store`, prévu pour les tests).
 */
export function createDefaultAudioBlobStore(): AudioBlobStore {
  return isIndexedDbAvailable() ? createIndexedDbAudioBlobStore() : createInMemoryAudioBlobStore();
}
