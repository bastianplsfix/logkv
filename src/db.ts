/**
 * A simple key-value database implementation using file-based storage.
 * Based on the approach from https://www.nan.fyi/database
 *
 * This implementation uses an append-only approach with immutable records:
 * - Updates are treated as inserts (append new record to end)
 * - Deletes use tombstone records (null values)
 * - Search returns the last occurrence of a key
 */

type Record = { key: string; value: string | null };

/**
 * Read all records from the database file.
 */
async function readAllRecords(dbPath: string): Promise<Record[]> {
  try {
    const content = await Deno.readTextFile(dbPath);
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
 * Append a record to the database file.
 */
async function appendRecord(
  dbPath: string,
  record: Record,
): Promise<void> {
  const line = `${record.key},${record.value}\n`;
  await Deno.writeTextFile(dbPath, line, { append: true });
}

/**
 * Set a key-value pair in the database.
 * Uses append-only approach: always appends a new record to the end of the file.
 */
export async function set(
  dbPath: string,
  key: string,
  value: string,
): Promise<void> {
  await appendRecord(dbPath, { key, value });
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
export async function del(dbPath: string, key: string): Promise<boolean> {
  const currentValue = await get(dbPath, key);

  if (currentValue === null) {
    return false; // Key doesn't exist or already deleted
  }

  // Append a tombstone record
  await appendRecord(dbPath, { key, value: null });
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
