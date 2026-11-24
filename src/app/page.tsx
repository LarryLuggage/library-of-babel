import { getServerCuratorSession } from "@/lib/auth/curator";
import { isLibrarianConfigured } from "@/lib/books/librarian";
import { listBooks, listConnections } from "@/lib/books/repository";
import { CatalogueApp } from "./catalogue-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ books, storageMode }, connections, initialAuth] = await Promise.all([
    listBooks(),
    listConnections(),
    getServerCuratorSession(),
  ]);

  return (
    <CatalogueApp
      initialBooks={books}
      initialConnections={connections}
      storageMode={storageMode}
      initialAuth={initialAuth}
      librarianEnabled={isLibrarianConfigured()}
    />
  );
}
