/**
 * A simple key-value database implementation using file-based storage.
 * Based on the approach from https://www.nan.fyi/database
 *
 * This implementation uses an append-only approach with immutable records:
 * - Updates are treated as inserts (append new record to end)
 * - Deletes use tombstone records (null values)
 * - Search returns the last occurrence of a key
 * - Files are segmented when they exceed a maximum size
 * - Old segments are compacted to remove stale/deleted data
 */

type Record = { key: string; value: string | null };

/**
 * Configuration for the database.
 */
export interface DbConfig {
  /** Maximum number of records per segment before rotation. Default: 1000 */
  maxSegmentRecords?: number;
}

const DEFAULT_MAX_SEGMENT_RECORDS = 1000;

/**
 * Get the base directory and name for segment files.
 */
function getSegmentInfo(dbPath: string): { dir: string; base: string } {
  const lastSlash = dbPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: ".", base: dbPath };
  }
  return {
    dir: dbPath.substring(0, lastSlash),
    base: dbPath.substring(lastSlash + 1),
  };
}

/**
 * Get the path for a specific segment file.
 */
function getSegmentPath(dbPath: string, segmentId: number): string {
  const { dir, base } = getSegmentInfo(dbPath);
  if (segmentId === 0) {
    return dbPath; // Main file
  }
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex === -1) {
    return `${dir}/${base}.${segmentId}`;
  }
  const name = base.substring(0, dotIndex);
  const ext = base.substring(dotIndex);
  return `${dir}/${name}.${segmentId}${ext}`;
}

/**
 * List all segment files for a database, sorted from oldest to newest.
 */
async function listSegments(dbPath: string): Promise<string[]> {
  const { dir, base } = getSegmentInfo(dbPath);
  const segments: Array<{ path: string; id: number }> = [];

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;

      // Check if this is a segment file
      const dotIndex = base.lastIndexOf(".");
      const baseName = dotIndex === -1 ? base : base.substring(0, dotIndex);
      const ext = dotIndex === -1 ? "" : base.substring(dotIndex);

      if (entry.name === base) {
        // Main file (segment 0)
        segments.push({ path: `${dir}/${entry.name}`, id: 0 });
      } else if (entry.name.startsWith(baseName + ".")) {
        // Check if it's a numbered segment
        const rest = entry.name.substring(baseName.length + 1);
        const segmentMatch = rest.match(/^(\d+)(.*)$/);
        if (segmentMatch && segmentMatch[2] === ext) {
          const id = parseInt(segmentMatch[1], 10);
          segments.push({ path: `${dir}/${entry.name}`, id });
        }
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }

  // Sort by segment ID (oldest to newest)
  segments.sort((a, b) => a.id - b.id);
  return segments.map((s) => s.path);
}

/**
 * Get the active (current) segment path.
 */
async function getActiveSegment(dbPath: string): Promise<string> {
  const segments = await listSegments(dbPath);
  return segments.length > 0 ? segments[segments.length - 1] : dbPath;
}

/**
 * Count records in a segment file.
 */
async function countRecords(segmentPath: string): Promise<number> {
  try {
    const content = await Deno.readTextFile(segmentPath);
    return content.split("\n").filter((line) => line.trim() !== "").length;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 0;
    }
    throw error;
  }
}

/**
 * Read all records from a single segment file.
 */
async function readSegmentRecords(segmentPath: string): Promise<Record[]> {
  try {
    const content = await Deno.readTextFile(segmentPath);
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => {
      const [key, ...valueParts] = line.split(",");
      const value = valueParts.join(",");
      // Handle tombstone records (null values)
      return { key, value: value === "null" ? null : value };
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Read all records from all segment files.
 * Returns records in order from oldest to newest segment.
 */
async function readAllRecords(dbPath: string): Promise<Record[]> {
  const segments = await listSegments(dbPath);
  const allRecords: Record[] = [];

  for (const segmentPath of segments) {
    const records = await readSegmentRecords(segmentPath);
    allRecords.push(...records);
  }

  return allRecords;
}

/**
 * Rotate segments: create a new segment and trigger compaction of old segments.
 * Returns the path to the new segment.
 */
async function rotateSegment(dbPath: string): Promise<string> {
  const segments = await listSegments(dbPath);

  // Get the highest segment ID and increment it
  // Can't just use segments.length because compaction may delete segments
  const segmentIds = segments.map((path) => {
    const match = path.match(/\.(\d+)\.db$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  const maxId = segmentIds.length > 0 ? Math.max(...segmentIds) : -1;
  const nextSegmentId = maxId + 1;
  const newSegmentPath = getSegmentPath(dbPath, nextSegmentId);

  // Create the new empty segment file
  await Deno.writeTextFile(newSegmentPath, "");

  // Only compact when we have at least 4 old segments
  // This prevents compacting too early and gives segments time to accumulate updates/deletes
  // Example: if segments = [db, 1.db, 2.db, 3.db] (where 3.db was just filled)
  // We created 4.db as the new active segment
  // We compact [db, 1.db, 2.db] but keep 3.db (most recently closed)
  if (segments.length >= 4) {
    // Compact all but the most recently closed segment
    const segmentsToCompact = segments.slice(0, -1);
    try {
      await compactSegments(dbPath, segmentsToCompact);
    } catch (err) {
      // Log compaction errors to stderr but don't fail the write
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Compaction error: ${message}`);
    }
  }

  return newSegmentPath;
}

/**
 * Compact multiple segments by removing stale and deleted records.
 * This merges older segments together, keeping only the latest value for each key.
 */
async function compactSegments(
  dbPath: string,
  segmentPaths: string[],
): Promise<void> {
  if (segmentPaths.length === 0) return;
  if (segmentPaths.length === 1) return; // Nothing to compact

  // Small delay to ensure any file handles are closed
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Read all records from segments to compact
  const allRecords: Record[] = [];
  for (const segmentPath of segmentPaths) {
    const records = await readSegmentRecords(segmentPath);
    allRecords.push(...records);
  }

  // Build map with latest value for each key
  const keyMap = new Map<string, string | null>();
  for (const record of allRecords) {
    keyMap.set(record.key, record.value);
  }

  // Write compacted data to a temporary file
  const firstSegmentPath = segmentPaths[0];
  const tempPath = `${firstSegmentPath}.compact.tmp`;

  const compactedRecords = Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null) // Remove tombstones
    .map(([key, value]) => `${key},${value}\n`)
    .join("");

  await Deno.writeTextFile(tempPath, compactedRecords);

  // Another small delay before file operations
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Delete all segments that were compacted
  for (const segmentPath of segmentPaths) {
    try {
      await Deno.remove(segmentPath);
    } catch (error) {
      // Ignore errors if file doesn't exist
      if (!(error instanceof Deno.errors.NotFound)) {
        // If we can't delete, clean up temp file and abort
        try {
          await Deno.remove(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }
    }
  }

  // Rename temp file to first segment
  await Deno.rename(tempPath, firstSegmentPath);
}

/**
 * Append a record to the active segment, rotating if necessary.
 */
async function appendRecord(
  dbPath: string,
  record: Record,
  config?: DbConfig,
): Promise<void> {
  const maxRecords = config?.maxSegmentRecords ?? DEFAULT_MAX_SEGMENT_RECORDS;
  const activeSegment = await getActiveSegment(dbPath);
  const recordCount = await countRecords(activeSegment);

  // Check if we need to rotate
  if (recordCount >= maxRecords) {
    const newSegmentPath = await rotateSegment(dbPath);
    const line = `${record.key},${record.value}\n`;
    await Deno.writeTextFile(newSegmentPath, line, { append: true });
  } else {
    const line = `${record.key},${record.value}\n`;
    await Deno.writeTextFile(activeSegment, line, { append: true });
  }
}

/**
 * Set a key-value pair in the database.
 * Uses append-only approach: always appends a new record to the end of the file.
 */
export async function set(
  dbPath: string,
  key: string,
  value: string,
  config?: DbConfig,
): Promise<void> {
  await appendRecord(dbPath, { key, value }, config);
}

/**
 * Get a value by key from the database.
 * Returns the last occurrence of the key (most recent value).
 * Returns null if the key doesn't exist or was deleted (tombstone).
 */
export async function get(
  dbPath: string,
  key: string,
): Promise<string | null> {
  const records = await readAllRecords(dbPath);
  // Search backwards to find the last occurrence
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].key === key) {
      return records[i].value;
    }
  }
  return null;
}

/**
 * Delete a key-value pair from the database.
 * Uses tombstone approach: appends a record with null value.
 * Returns true if the key exists, false if it doesn't exist or is already deleted.
 */
export async function del(
  dbPath: string,
  key: string,
  config?: DbConfig,
): Promise<boolean> {
  const currentValue = await get(dbPath, key);

  if (currentValue === null) {
    return false; // Key doesn't exist or already deleted
  }

  // Append a tombstone record
  await appendRecord(dbPath, { key, value: null }, config);
  return true;
}

/**
 * List all keys in the database.
 * Only returns keys that have non-null values (excludes tombstones and duplicates).
 */
export async function keys(dbPath: string): Promise<string[]> {
  const records = await readAllRecords(dbPath);
  const keyMap = new Map<string, string | null>();

  // Build map with last occurrence of each key
  for (const record of records) {
    keyMap.set(record.key, record.value);
  }

  // Return only keys with non-null values
  return Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .map(([key, _]) => key);
}

/**
 * Get all key-value pairs in the database.
 * Only returns records with non-null values (excludes tombstones and duplicates).
 */
export async function all(dbPath: string): Promise<Record[]> {
  const records = await readAllRecords(dbPath);
  const keyMap = new Map<string, string | null>();

  // Build map with last occurrence of each key
  for (const record of records) {
    keyMap.set(record.key, record.value);
  }

  // Return only entries with non-null values
  return Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .map(([key, value]) => ({ key, value }));
}
