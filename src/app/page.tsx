import { getServerCuratorSession } from "@/lib/auth/curator";
import { isLibrarianConfigured } from "@/lib/books/librarian";
import {
  listBooks,
  listConnections,
  listQuotes,
  listReadingLists,
} from "@/lib/books/repository";
import { CatalogueApp } from "./catalogue-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [
    { books, storageMode },
    connections,
    quotes,
    lists,
    initialAuth,
  ] = await Promise.all([
    listBooks(),
    listConnections(),
    listQuotes(),
    listReadingLists(),
    getServerCuratorSession(),
  ]);

  return (
    <CatalogueApp
      initialBooks={books}
      initialConnections={connections}
      initialQuotes={quotes}
      initialLists={lists}
      storageMode={storageMode}
      initialAuth={initialAuth}
      librarianEnabled={isLibrarianConfigured()}
    />
  );
}
