"use client";

import { useMemo, useState } from "react";
import {
  getBookKey,
  getCatalogueConnection,
  getDivision,
  getNearestConnections,
  type CatalogueBook,
  type CatalogueConnection,
} from "@/lib/books/catalogue";

type PositionedConnection = CatalogueConnection & {
  x: number;
  y: number;
};

type BookBridge = {
  first: PositionedConnection;
  second: PositionedConnection;
  score: number;
};

const NEIGHBOR_COUNT = 9;
const MAP_SIZE = {
  centerX: 360,
  centerY: 280,
};

function getDefaultBookKey(books: CatalogueBook[]) {
  const borgesAnchor = books.find(
    (book) =>
      book.author === "Jorge Luis Borges" && book.title === "Collected Fictions",
  );

  return getBookKey(borgesAnchor ?? books[0]);
}

function getPosition(index: number, count: number) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
  const radius = 228;

  return {
    x: Number((MAP_SIZE.centerX + Math.cos(angle) * radius).toFixed(3)),
    y: Number((MAP_SIZE.centerY + Math.sin(angle) * radius).toFixed(3)),
  };
}

function positionConnections(connections: CatalogueConnection[]) {
  return connections.map((connection, index) => ({
    ...connection,
    ...getPosition(index, connections.length),
  }));
}

function getBookBridges(connections: PositionedConnection[]) {
  const bridges: BookBridge[] = [];

  connections.forEach((first, firstIndex) => {
    connections.slice(firstIndex + 1).forEach((second) => {
      const bridge = getCatalogueConnection(first.book, second.book);

      if (bridge && bridge.score >= 7) {
        bridges.push({
          first,
          score: bridge.score,
          second,
        });
      }
    });
  });

  return bridges.sort((first, second) => second.score - first.score).slice(0, 12);
}

function getReasonLabel(reasons: string[]) {
  return reasons[0]?.replace(/\.$/, "") ?? "Catalogue link";
}

export function CatalogueConstellation({
  books,
}: {
  books: CatalogueBook[];
}) {
  const booksByKey = useMemo(
    () => new Map(books.map((book) => [getBookKey(book), book])),
    [books],
  );
  const [focusKey, setFocusKey] = useState(() => getDefaultBookKey(books));
  const [connectionKey, setConnectionKey] = useState("");
  const focusBook = booksByKey.get(focusKey) ?? books[0];
  const connections = useMemo(
    () => positionConnections(getNearestConnections(focusBook, books, NEIGHBOR_COUNT)),
    [books, focusBook],
  );
  const selectedConnection =
    connections.find((connection) => getBookKey(connection.book) === connectionKey) ??
    connections[0];
  const bridges = useMemo(() => getBookBridges(connections), [connections]);

  return (
    <section className="catalogue-constellation" aria-labelledby="map-title">
      <div className="catalogue-map-heading">
        <p>Relational map no. 1</p>
        <h2 id="map-title">Similarity constellation</h2>
        <div className="catalogue-map-picker">
          <label htmlFor="focus-volume">Focus volume</label>
          <select
            id="focus-volume"
            onChange={(event) => {
              setConnectionKey("");
              setFocusKey(event.target.value);
            }}
            value={focusKey}
          >
            {books.map((book) => (
              <option key={getBookKey(book)} value={getBookKey(book)}>
                {book.author}: {book.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="catalogue-map-body">
        <div
          className="catalogue-map-plot"
          aria-label={`Books nearest ${focusBook.title} by current catalogue relationships`}
        >
          <svg aria-hidden="true" viewBox="0 0 720 560">
            <g className="catalogue-map-bridges">
              {bridges.map((bridge) => (
                <line
                  key={`${getBookKey(bridge.first.book)}-${getBookKey(bridge.second.book)}`}
                  x1={bridge.first.x}
                  x2={bridge.second.x}
                  y1={bridge.first.y}
                  y2={bridge.second.y}
                />
              ))}
            </g>
            <g className="catalogue-map-rays">
              {connections.map((connection) => (
                <line
                  key={getBookKey(connection.book)}
                  x1={MAP_SIZE.centerX}
                  x2={connection.x}
                  y1={MAP_SIZE.centerY}
                  y2={connection.y}
                />
              ))}
            </g>
          </svg>

          <div className="catalogue-map-center">
            <span>{getDivision(focusBook)}</span>
            <cite>{focusBook.title}</cite>
            <strong>{focusBook.author}</strong>
          </div>

          {connections.map((connection) => {
            const bookKey = getBookKey(connection.book);
            const isSelected = bookKey === getBookKey(selectedConnection.book);

            return (
              <button
                aria-pressed={isSelected}
                className="catalogue-map-node"
                data-selected={isSelected}
                key={bookKey}
                onClick={() => setConnectionKey(bookKey)}
                style={{
                  left: `${(connection.x / 720) * 100}%`,
                  top: `${(connection.y / 560) * 100}%`,
                }}
                title={getReasonLabel(connection.reasons)}
                type="button"
              >
                <cite>{connection.book.title}</cite>
                <span>{connection.book.author}</span>
              </button>
            );
          })}
        </div>

        <aside className="catalogue-map-notes" aria-live="polite">
          <p>Nearest linked volume</p>
          <h3>{selectedConnection.book.title}</h3>
          <strong>{selectedConnection.book.author}</strong>
          <dl>
            <div>
              <dt>Division</dt>
              <dd>{getDivision(selectedConnection.book)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                Shelf {selectedConnection.book.shelf}.{" "}
                {selectedConnection.book.position}.
              </dd>
            </div>
          </dl>
          {selectedConnection.book.summary && (
            <p className="catalogue-map-summary">
              {selectedConnection.book.summary}
            </p>
          )}
          {selectedConnection.book.tags && selectedConnection.book.tags.length > 0 && (
            <div className="catalogue-map-tags" aria-label="Book tags">
              {selectedConnection.book.tags.map((tag) => (
                <span key={tag} className="catalogue-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h4>Why it appears</h4>
          <ul>
            {selectedConnection.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
