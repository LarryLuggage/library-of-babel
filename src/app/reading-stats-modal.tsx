"use client";

import { useId, useMemo, useState } from "react";
import {
  getBookKey,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
} from "@/lib/books/catalogue";
import {
  computeCatalogueStats,
  serializeBooksToCsv,
  serializeBooksToJson,
} from "@/lib/books/stats";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function getLocalTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ReadingStatsContent<T extends CatalogueBook>({
  books,
  titleId,
  onClose,
  onBookClick,
}: {
  books: readonly T[];
  titleId: string;
  onClose: () => void;
  onBookClick: (book: T) => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const divisionCaptionId = useId();
  const [exportStatus, setExportStatus] = useState("");

  const stats = useMemo(() => computeCatalogueStats(books), [books]);

  const maxRatingCount = useMemo(
    () =>
      Math.max(
        1,
        ...([1, 2, 3, 4, 5] as const).map(
          (star) => stats.ratingHistogram[star],
        ),
      ),
    [stats.ratingHistogram],
  );

  const triggerDownload = (format: "json" | "csv") => {
    const today = getLocalTodayIsoDate();
    const isJson = format === "json";
    const content = isJson
      ? serializeBooksToJson(books)
      : serializeBooksToCsv(books);
    const mimeType = isJson
      ? "application/json;charset=utf-8"
      : "text/csv;charset=utf-8";
    const filename = `library-of-babel-${today}.${format}`;

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExportStatus(
      `Exported ${books.length} ${books.length === 1 ? "volume" : "volumes"} as ${filename}.`,
    );
  };

  return (
    <div className="catalogue-stats-card">
      <button
        type="button"
        className="card-close-slip"
        onClick={closeDialog}
        aria-label="Close Reading Statistics & Export"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <header className="pathfinder-card-header">
        <span className="card-rubric-tag font-mono">collection analytics</span>
        <h2 id={titleId}>Reading Statistics &amp; Export</h2>
        <p className="pathfinder-subtitle">
          Reading progress, rating distribution, division tallies, active loans,
          and archival exports across {stats.totalBooks}{" "}
          {stats.totalBooks === 1 ? "volume" : "volumes"}.
        </p>
      </header>

      <dl className="stats-kpi-strip" aria-label="Reading summary metrics">
        <div className="stats-kpi-item">
          <dt>Completion</dt>
          <dd>{stats.completionPercent}%</dd>
        </div>
        <div className="stats-kpi-item">
          <dt>Finished</dt>
          <dd>{stats.statusCounts.finished}</dd>
        </div>
        <div className="stats-kpi-item">
          <dt>Reading</dt>
          <dd>{stats.statusCounts.reading}</dd>
        </div>
        <div className="stats-kpi-item">
          <dt>Unread</dt>
          <dd>{stats.statusCounts.unread}</dd>
        </div>
        <div className="stats-kpi-item">
          <dt>Avg Rating</dt>
          <dd>
            {stats.averageRating !== null
              ? `${stats.averageRating.toFixed(1)} ★`
              : "—"}
          </dd>
        </div>
        <div className="stats-kpi-item">
          <dt>Loaned Out</dt>
          <dd>{stats.loanedCount}</dd>
        </div>
      </dl>

      <div className="stats-charts-grid">
        <section
          className="stats-panel"
          aria-labelledby={`${titleId}-progress-heading`}
        >
          <h3 id={`${titleId}-progress-heading`}>Reading Progress</h3>
          <ul className="stats-bar-list">
            {READING_STATUS_VALUES.map((status) => {
              const count = stats.statusCounts[status];
              const pct =
                stats.totalBooks > 0
                  ? Math.round((count / stats.totalBooks) * 100)
                  : 0;
              return (
                <li key={status} className="stats-bar-row">
                  <div className="stats-bar-meta">
                    <span className="stats-bar-label">
                      {READING_STATUS_LABELS[status]}
                    </span>
                    <span className="stats-bar-value font-mono">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="stats-bar-track" aria-hidden="true">
                    <div
                      className={`stats-bar-fill stats-bar-fill--${status}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          className="stats-panel"
          aria-labelledby={`${titleId}-rating-heading`}
        >
          <h3 id={`${titleId}-rating-heading`}>
            Rating Distribution{" "}
            <span className="stats-heading-note font-mono">
              ({stats.ratedCount} rated)
            </span>
          </h3>
          <ul className="stats-bar-list">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const count = stats.ratingHistogram[star];
              const barPct = Math.round((count / maxRatingCount) * 100);
              const sharePct =
                stats.ratedCount > 0
                  ? Math.round((count / stats.ratedCount) * 100)
                  : 0;
              return (
                <li key={star} className="stats-bar-row">
                  <div className="stats-bar-meta">
                    <span className="stats-bar-label">
                      {star} {star === 1 ? "star" : "stars"} ({"★".repeat(star)})
                    </span>
                    <span className="stats-bar-value font-mono">
                      {count} ({sharePct}%)
                    </span>
                  </div>
                  <div className="stats-bar-track" aria-hidden="true">
                    <div
                      className="stats-bar-fill stats-bar-fill--rating"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="stats-panel">
        <div
          className="stats-table-wrapper"
          tabIndex={0}
          role="region"
          aria-labelledby={divisionCaptionId}
        >
          <table className="stats-table">
            <caption id={divisionCaptionId}>Division Breakdown</caption>
            <thead>
              <tr>
                <th scope="col">Division</th>
                <th scope="col">Volumes</th>
                <th scope="col">Finished</th>
                <th scope="col">Reading</th>
              </tr>
            </thead>
            <tbody>
              {stats.divisionBreakdown.map((division) => (
                <tr key={division.name}>
                  <th scope="row">{division.name}</th>
                  <td>{division.total}</td>
                  <td>{division.finished}</td>
                  <td>{division.reading}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="stats-charts-grid">
        <section
          className="stats-panel"
          aria-labelledby={`${titleId}-authors-heading`}
        >
          <h3 id={`${titleId}-authors-heading`}>Top Authors</h3>
          {stats.topAuthors.length === 0 ? (
            <p className="stats-empty-note">No authors recorded yet.</p>
          ) : (
            <ol className="stats-summary-list">
              {stats.topAuthors.slice(0, 10).map((item) => (
                <li key={item.author}>
                  <span className="stats-summary-name">{item.author}</span>
                  <span className="stats-summary-count font-mono">
                    {item.count} {item.count === 1 ? "vol." : "vols."}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className="stats-panel"
          aria-labelledby={`${titleId}-years-heading`}
        >
          <h3 id={`${titleId}-years-heading`}>Finished by Year</h3>
          {stats.finishedByYear.length === 0 ? (
            <p className="stats-empty-note">
              No completion dates recorded yet. Mark a volume as Finished to
              populate this ledger.
            </p>
          ) : (
            <ul className="stats-summary-list">
              {stats.finishedByYear.map((item) => (
                <li key={item.year}>
                  <span className="stats-summary-name">{item.year}</span>
                  <span className="stats-summary-count font-mono">
                    {item.count} {item.count === 1 ? "vol." : "vols."}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        className="stats-panel"
        aria-labelledby={`${titleId}-loans-heading`}
      >
        <h3 id={`${titleId}-loans-heading`}>
          Active Loans ({stats.loanedCount})
        </h3>
        {stats.loanedBooks.length === 0 ? (
          <p className="stats-empty-note">
            No volumes are currently loaned out.
          </p>
        ) : (
          <ul className="stats-loans-list">
            {stats.loanedBooks.map((book) => (
              <li key={getBookKey(book)}>
                <button
                  type="button"
                  className="stats-loan-btn"
                  onClick={() => onBookClick(book)}
                  aria-haspopup="dialog"
                >
                  <span className="stats-loan-main">
                    <cite>{book.title}</cite>
                    <span className="stats-loan-author">
                      {book.author} · Shelf {book.shelf}
                    </span>
                  </span>
                  <span className="stats-loan-borrower font-mono">
                    Loaned to {book.loaned_to}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="stats-panel stats-export-panel"
        aria-labelledby={`${titleId}-export-heading`}
      >
        <div className="stats-export-header">
          <div>
            <h3 id={`${titleId}-export-heading`}>Archival Export</h3>
            <p className="stats-empty-note">
              Download the complete catalogue and reading ledger for backup or
              external analysis.
            </p>
          </div>
          <div className="stats-export-buttons">
            <button
              type="button"
              className="pathfinder-btn btn-secondary font-mono"
              onClick={() => triggerDownload("json")}
            >
              Download JSON
            </button>
            <button
              type="button"
              className="pathfinder-btn btn-primary font-mono"
              onClick={() => triggerDownload("csv")}
            >
              Download CSV
            </button>
          </div>
        </div>
        {exportStatus && (
          <p className="stats-export-status font-mono" role="status">
            {exportStatus}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Native modal dialog displaying collection reading analytics, active loans, and JSON/CSV export actions.
 */
export function ReadingStatsModal<T extends CatalogueBook>({
  open = true,
  books,
  onClose,
  onBookClick,
}: {
  open?: boolean;
  books: readonly T[];
  onClose: () => void;
  onBookClick: (book: T) => void;
}) {
  const titleId = useId();

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="catalogue-dialog--stats"
    >
      <ReadingStatsContent
        books={books}
        titleId={titleId}
        onClose={onClose}
        onBookClick={onBookClick}
      />
    </ModalDialog>
  );
}
