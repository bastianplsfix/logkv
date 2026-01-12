/**
 * A simple key-value database implementation using file-based storage.
 * Based on the approach from https://www.nan.fyi/database
 */

type Record = { key: string; value: string };

/**
 * Read all records from the database file.
 */
async function readAllRecords(dbPath: string): Promise<Record[]> {
  try {
    const content = await Deno.readTextFile(dbPath);
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => {
      const [key, ...valueParts] = line.split(",");
      return { key, value: valueParts.join(",") };
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Write all records to the database file.
 */
async function writeAllRecords(
  dbPath: string,
  records: Record[],
): Promise<void> {
  const content = records.map((r) => `${r.key},${r.value}`).join("\n");
  await Deno.writeTextFile(dbPath, content);
}

/**
 * Set a key-value pair in the database.
 * If the key exists, update it. Otherwise, add a new record.
 */
export async function set(
  dbPath: string,
  key: string,
  value: string,
): Promise<void> {
  const records = await readAllRecords(dbPath);
  const existingIndex = records.findIndex((record) => record.key === key);

  if (existingIndex !== -1) {
    // Update existing record
    records[existingIndex].value = value;
  } else {
    // Add new record
    records.push({ key, value });
  }

  await writeAllRecords(dbPath, records);
}

/**
 * Get a value by key from the database.
 * Returns null if the key doesn't exist.
 */
export async function get(
  dbPath: string,
  key: string,
): Promise<string | null> {
  const records = await readAllRecords(dbPath);
  const record = records.find((r) => r.key === key);
  return record ? record.value : null;
}

/**
 * Delete a key-value pair from the database.
 * Returns true if the key was found and deleted, false otherwise.
 */
export async function del(dbPath: string, key: string): Promise<boolean> {
  const records = await readAllRecords(dbPath);
  const filteredRecords = records.filter((record) => record.key !== key);

  if (filteredRecords.length === records.length) {
    return false; // Key not found
  }

  await writeAllRecords(dbPath, filteredRecords);
  return true;
}

/**
 * List all keys in the database.
 */
export async function keys(dbPath: string): Promise<string[]> {
  const records = await readAllRecords(dbPath);
  return records.map((r) => r.key);
}

/**
 * Get all key-value pairs in the database.
 */
export async function all(dbPath: string): Promise<Record[]> {
  return await readAllRecords(dbPath);
}
