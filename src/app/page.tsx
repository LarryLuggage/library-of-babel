import { cache } from "react";
import type { Metadata } from "next";
import { getServerCuratorSession } from "@/lib/auth/curator";
import { isLibrarianConfigured } from "@/lib/books/librarian";
import {
  listBooks,
  listConnections,
  listQuotes,
  listReadingLists,
} from "@/lib/books/repository";
import {
  buildDynamicPageDescription,
  buildDynamicPageTitle,
  parseCatalogueSearchParams,
} from "@/lib/books/url-state";
import { CatalogueApp } from "./catalogue-app";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const loadPageCatalogueData = cache(async () => {
  const [{ books, storageMode }, connections, quotes, lists, initialAuth] =
    await Promise.all([
      listBooks(),
      listConnections(),
      listQuotes(),
      listReadingLists(),
      getServerCuratorSession(),
    ]);

  return {
    books,
    storageMode,
    connections,
    quotes,
    lists,
    initialAuth,
  };
});

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const [resolvedSearchParams, { books, lists }] = await Promise.all([
    searchParams,
    loadPageCatalogueData(),
  ]);

  const urlState = parseCatalogueSearchParams(resolvedSearchParams);
  const title = buildDynamicPageTitle(urlState, books, lists);
  const description = buildDynamicPageDescription(urlState, books, lists);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [
    resolvedSearchParams,
    { books, storageMode, connections, quotes, lists, initialAuth },
  ] = await Promise.all([searchParams, loadPageCatalogueData()]);

  const initialUrlState = parseCatalogueSearchParams(resolvedSearchParams);

  return (
    <CatalogueApp
      initialBooks={books}
      initialConnections={connections}
      initialQuotes={quotes}
      initialLists={lists}
      storageMode={storageMode}
      initialAuth={initialAuth}
      librarianEnabled={isLibrarianConfigured()}
      initialUrlState={initialUrlState}
    />
  );
}
