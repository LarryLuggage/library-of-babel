import { listBooks } from "@/lib/books/repository";
import { CatalogueApp } from "./catalogue-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { books, storageMode } = await listBooks();

  return <CatalogueApp initialBooks={books} storageMode={storageMode} />;
}
