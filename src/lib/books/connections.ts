export const CONNECTION_TYPES = [
  "influenced_by",
  "responds_to",
  "paired_reading",
  "shared_lineage",
  "contrasts_with",
  "custom",
] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  influenced_by: "Influenced by",
  responds_to: "Responds to",
  paired_reading: "Paired reading",
  shared_lineage: "Shared lineage",
  contrasts_with: "Contrasts with",
  custom: "Curator note",
};

export type EditorialConnection = {
  id: string;
  source_book_id: string;
  target_book_id: string;
  connection_type: ConnectionType;
  description: string | null;
  weight: number;
  created_at: string;
};

export type CreateConnectionInput = {
  source_book_id: string;
  target_book_id: string;
  connection_type: ConnectionType;
  description: string | null;
  weight: number;
};

export type ConnectionValidationResult =
  | { ok: true; data: CreateConnectionInput }
  | { ok: false; error: string; errors: string[] };

const MAX_DESCRIPTION_LENGTH = 500;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 3;
const DEFAULT_WEIGHT = 2;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConnectionType(value: unknown): value is ConnectionType {
  return (
    typeof value === "string" &&
    (CONNECTION_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeConnectionPairKey(firstId: string, secondId: string): string {
  return firstId < secondId
    ? `${firstId}\u0000${secondId}`
    : `${secondId}\u0000${firstId}`;
}

export function buildEditorialConnectionMap(
  connections: readonly EditorialConnection[] | undefined,
): Map<string, EditorialConnection> {
  const map = new Map<string, EditorialConnection>();
  if (!connections) {
    return map;
  }

  for (const conn of connections) {
    if (!conn.source_book_id || !conn.target_book_id) {
      continue;
    }
    map.set(
      normalizeConnectionPairKey(conn.source_book_id, conn.target_book_id),
      conn,
    );
  }

  return map;
}

/**
 * Validates and normalizes a payload for creating a curated editorial link between two volumes.
 */
export function validateCreateConnectionInput(
  payload: unknown,
): ConnectionValidationResult {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];

  const sourceId =
    typeof payload.source_book_id === "string"
      ? payload.source_book_id.trim()
      : "";
  if (!sourceId) {
    errors.push("source_book_id is required.");
  }

  const targetId =
    typeof payload.target_book_id === "string"
      ? payload.target_book_id.trim()
      : "";
  if (!targetId) {
    errors.push("target_book_id is required.");
  }

  if (sourceId && targetId && sourceId === targetId) {
    errors.push("Cannot link a volume to itself.");
  }

  let connectionType: ConnectionType = "custom";
  if (payload.connection_type !== undefined) {
    if (!isConnectionType(payload.connection_type)) {
      errors.push(
        `connection_type must be one of: ${CONNECTION_TYPES.join(", ")}.`,
      );
    } else {
      connectionType = payload.connection_type;
    }
  }

  let description: string | null = null;
  if (payload.description !== undefined && payload.description !== null) {
    if (typeof payload.description !== "string") {
      errors.push("description must be a string or null.");
    } else {
      const trimmed = payload.description.trim();
      if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(
          `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
        );
      } else if (trimmed.length > 0) {
        description = trimmed;
      }
    }
  }

  let weight = DEFAULT_WEIGHT;
  if (payload.weight !== undefined && payload.weight !== null) {
    if (
      typeof payload.weight !== "number" ||
      !Number.isInteger(payload.weight) ||
      payload.weight < MIN_WEIGHT ||
      payload.weight > MAX_WEIGHT
    ) {
      errors.push(
        `weight must be an integer between ${MIN_WEIGHT} and ${MAX_WEIGHT}.`,
      );
    } else {
      weight = payload.weight;
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return {
    ok: true,
    data: {
      source_book_id: sourceId,
      target_book_id: targetId,
      connection_type: connectionType,
      description,
      weight,
    },
  };
}
