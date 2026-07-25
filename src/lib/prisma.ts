import { PrismaClient } from "@prisma/client";

// Singleton Prisma client — évite l'épuisement des connexions en dev (hot-reload
// Next.js instancierait sinon un nouveau client à chaque rechargement de module).
// Pattern standard recommandé par Prisma pour Next.js.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
