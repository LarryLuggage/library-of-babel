"use client";

import { useMemo } from "react";
import bookEnrichment from "../../book-enrichment.json";
import { getBookKey, getDivision, type CatalogueBook } from "@/lib/books/catalogue";

type TimelineBook = CatalogueBook & { number: number };

interface ChronologicalScrollProps {
  books: TimelineBook[];
  onBookClick: (book: TimelineBook) => void;
}

interface EnrichedBookItem {
  author: string;
  title: string;
  shelf: string | number;
  position: string | number;
  sources?: {
    open_library?: {
      first_publish_year?: number;
    };
    open_library_work?: {
      first_publish_year?: number;
    };
    google_books?: {
      publishedDate?: string;
    };
  };
}

export function ChronologicalScroll({ books, onBookClick }: ChronologicalScrollProps) {
  // Map book key to publish year from enrichment data
  const bookYearsMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const item of bookEnrichment as unknown as EnrichedBookItem[]) {
      const key = JSON.stringify([item.author, item.title, item.shelf, item.position]);
      const ol = item.sources?.open_library?.first_publish_year;
      const olw = item.sources?.open_library_work?.first_publish_year;
      const gbDate = item.sources?.google_books?.publishedDate;
      const gb = gbDate ? parseInt(gbDate.match(/\b\d{4}\b/)?.[0] || "0") : 0;
      const year = ol || olw || gb || null;
      map.set(key, year ? Number(year) : null);
    }
    return map;
  }, []);

  // Group books by decade
  const decadeGroups = useMemo(() => {
    const groups: { [key: string]: TimelineBook[] } = {};

    for (const book of books) {
      const key = getBookKey(book);
      const year = bookYearsMap.get(key);

      let decadeLabel = "Undated";
      if (year && !isNaN(year)) {
        const decadeStart = Math.floor(year / 10) * 10;
        decadeLabel = `${decadeStart}s`;
      }

      if (!groups[decadeLabel]) {
        groups[decadeLabel] = [];
      }
      groups[decadeLabel].push(book);
    }

    // Sort decade keys: numerical decades ascending, then "Undated"
    const sortedDecades = Object.keys(groups).sort((a, b) => {
      if (a === "Undated") return 1;
      if (b === "Undated") return -1;
      const numA = parseInt(a);
      const numB = parseInt(b);
      return numA - numB;
    });

    return sortedDecades.map((decade) => ({
      decade,
      books: groups[decade].sort((first, second) => {
        const yearA = bookYearsMap.get(getBookKey(first)) || 9999;
        const yearB = bookYearsMap.get(getBookKey(second)) || 9999;
        if (yearA !== yearB) return yearA - yearB;
        return first.author.localeCompare(second.author) || first.title.localeCompare(second.title);
      }),
    }));
  }, [books, bookYearsMap]);

  return (
    <section className="catalogue-timeline-section" aria-labelledby="timeline-title">
      <div className="catalogue-timeline-heading">
        <p>Chronological display</p>
        <h2 id="timeline-title">Timeline of Volumes</h2>
      </div>

      <div className="catalogue-timeline-scroll">
        <div className="catalogue-timeline-track">
          {decadeGroups.map(({ decade, books }) => (
            <div key={decade} className="timeline-decade-column">
              <div className="timeline-decade-header">
                <h3>{decade}</h3>
                <span className="timeline-decade-count">{books.length} volumes</span>
              </div>
              <ol className="timeline-book-list">
                {books.map((book) => {
                  const key = getBookKey(book);
                  const year = bookYearsMap.get(key);

                  return (
                    <li
                      key={book.number}
                      className="timeline-book-card"
                      onClick={() => onBookClick(book)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onBookClick(book);
                        }
                      }}
                    >
                      <div className="timeline-book-info">
                        <cite className="timeline-book-title">{book.title}</cite>
                        <span className="timeline-book-author">{book.author}</span>
                        {year && <span className="timeline-book-year">{year}</span>}
                      </div>
                      <div className="timeline-book-meta">
                        <span className="timeline-book-division">{getDivision(book)}</span>
                        <span className="timeline-book-shelf">S. {book.shelf}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
