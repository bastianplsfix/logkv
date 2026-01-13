/**
 * A simple key-value database implementation using LSM tree architecture.
 * Based on the approach from https://www.nan.fyi/database
 *
 * This implementation uses an LSM (Log-Structured Merge) tree:
 * - Writes go to an in-memory memtable (sorted structure)
 * - A write-ahead log (WAL) provides crash recovery
 * - When memtable is full, it's flushed to disk as a sorted SSTable
 * - SSTables are immutable sorted files
 * - Sparse indices allow memory-efficient lookups in sorted data
 * - Reads check memtable first, then SSTables (newest to oldest)
 * - Compaction merges SSTables to remove stale data
 */

type Record = { key: string; value: string | null };

/**
 * Memtable: In-memory sorted structure for recent writes.
 * Implemented as a Map with sorted keys for efficient range queries.
 */
class Memtable {
  private data: Map<string, string | null> = new Map();

  set(key: string, value: string | null): void {
    this.data.set(key, value);
  }

  get(key: string): string | null | undefined {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  size(): number {
    return this.data.size;
  }

  /**
   * Get all entries sorted by key.
   */
  getSortedEntries(): Array<[string, string | null]> {
    return Array.from(this.data.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }

  /**
   * Get entries in a key range [start, end).
   */
  range(start?: string, end?: string): Array<[string, string | null]> {
    const entries = this.getSortedEntries();
    return entries.filter(([key]) => {
      if (start && key < start) return false;
      if (end && key >= end) return false;
      return true;
    });
  }

  clear(): void {
    this.data.clear();
  }
}

/**
 * Sparse index for an SSTable.
 * Only stores every Nth key to save memory.
 */
type SparseIndex = Array<{ key: string; offset: number }>;

/**
 * In-memory index for a segment file.
 * Maps keys to their byte offsets in the file.
 */
type SegmentIndex = Map<string, number>;

/**
 * Global memtable: current in-memory sorted structure
 * This is kept in memory for fast writes and reads.
 * Maps database path to its memtable.
 */
const globalMemtables = new Map<string, Memtable>();

/**
 * Get or create memtable for a database.
 */
async function getMemtable(dbPath: string): Promise<Memtable> {
  let memtable = globalMemtables.get(dbPath);
  if (!memtable) {
    // Try to recover from WAL if it exists
    memtable = await recoverFromWAL(dbPath);
    globalMemtables.set(dbPath, memtable);
  }
  return memtable;
}

/**
 * Global index map: segment path -> segment index
 * This is kept in memory for fast lookups.
 */
const segmentIndices = new Map<string, SegmentIndex>();

/**
 * Global sparse index map: SSTable path -> sparse index
 */
const sparseIndices = new Map<string, SparseIndex>();

/**
 * Configuration for the database.
 */
export interface DbConfig {
  /** Maximum number of records in memtable before flushing to disk. Default: 1000 */
  maxMemtableRecords?: number;
  /** Maximum number of records per segment before rotation. Default: 1000 */
  maxSegmentRecords?: number;
  /** Sparse index density: store every Nth key. Default: 10 (every 10th key) */
  sparseIndexDensity?: number;
}

const DEFAULT_MAX_MEMTABLE_RECORDS = 1000;
const DEFAULT_MAX_SEGMENT_RECORDS = 1000;
const DEFAULT_SPARSE_INDEX_DENSITY = 10;

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
 * Get the path for the write-ahead log (WAL).
 */
function getWALPath(dbPath: string): string {
  const { dir, base } = getSegmentInfo(dbPath);
  const dotIndex = base.lastIndexOf(".");
  const name = dotIndex === -1 ? base : base.substring(0, dotIndex);
  return `${dir}/${name}.wal`;
}

/**
 * Append a record to the write-ahead log.
 */
async function appendToWAL(
  dbPath: string,
  key: string,
  value: string | null,
): Promise<void> {
  const walPath = getWALPath(dbPath);
  const line = `${key},${value}\n`;
  await Deno.writeTextFile(walPath, line, { append: true });
}

/**
 * Clear the write-ahead log.
 */
async function clearWAL(dbPath: string): Promise<void> {
  const walPath = getWALPath(dbPath);
  try {
    await Deno.remove(walPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/**
 * Recover memtable from write-ahead log.
 */
async function recoverFromWAL(dbPath: string): Promise<Memtable> {
  const walPath = getWALPath(dbPath);
  const memtable = new Memtable();

  try {
    const content = await Deno.readTextFile(walPath);
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      const commaIndex = line.indexOf(",");
      if (commaIndex !== -1) {
        const key = line.substring(0, commaIndex);
        const value = line.substring(commaIndex + 1);
        memtable.set(key, value === "null" ? null : value);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return memtable;
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
 * Build an index for a segment file.
 * Reads through the file and creates a map of key -> byte offset.
 */
async function buildSegmentIndex(segmentPath: string): Promise<SegmentIndex> {
  const index: SegmentIndex = new Map();

  try {
    const file = await Deno.open(segmentPath, { read: true });
    const decoder = new TextDecoder();
    let offset = 0;
    let buffer = "";

    try {
      // Read file in chunks and process line by line
      for await (const chunk of file.readable) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");

        // Process all complete lines (leave the last incomplete line in buffer)
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() !== "") {
            // Extract the key (everything before the first comma)
            const commaIndex = line.indexOf(",");
            if (commaIndex !== -1) {
              const key = line.substring(0, commaIndex);
              index.set(key, offset);
            }
          }
          // Update offset (add 1 for newline character)
          offset += new TextEncoder().encode(line + "\n").length;
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim() !== "") {
        const commaIndex = buffer.indexOf(",");
        if (commaIndex !== -1) {
          const key = buffer.substring(0, commaIndex);
          index.set(key, offset);
        }
      }
    } finally {
      // File handle is automatically closed by readable stream, but ensure it's closed
      try {
        file.close();
      } catch {
        // Ignore - may already be closed
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return index; // Empty index for non-existent file
    }
    throw error;
  }

  return index;
}

/**
 * Get or build the index for a segment file.
 * Uses cached index if available, otherwise builds and caches it.
 */
async function getSegmentIndex(segmentPath: string): Promise<SegmentIndex> {
  let index = segmentIndices.get(segmentPath);
  if (!index) {
    index = await buildSegmentIndex(segmentPath);
    segmentIndices.set(segmentPath, index);
  }
  return index;
}

/**
 * Update the index for a segment by adding a new key-offset pair.
 */
function updateSegmentIndex(
  segmentPath: string,
  key: string,
  offset: number,
): void {
  let index = segmentIndices.get(segmentPath);
  if (!index) {
    index = new Map();
    segmentIndices.set(segmentPath, index);
  }
  index.set(key, offset);
}

/**
 * Clear the index for a segment (used when segment is deleted during compaction).
 */
function clearSegmentIndex(segmentPath: string): void {
  segmentIndices.delete(segmentPath);
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
 * Read a single record from a segment at a specific byte offset.
 */
async function readRecordAtOffset(
  segmentPath: string,
  offset: number,
): Promise<Record | null> {
  try {
    const file = await Deno.open(segmentPath, { read: true });
    await file.seek(offset, Deno.SeekMode.Start);

    const decoder = new TextDecoder();
    let line = "";

    // Read until we hit a newline
    const buffer = new Uint8Array(1);
    while (true) {
      const bytesRead = await file.read(buffer);
      if (bytesRead === null) break; // EOF

      const char = decoder.decode(buffer);
      if (char === "\n") break;
      line += char;
    }

    file.close();

    if (line.trim() === "") return null;

    // Parse the record
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) return null;

    const key = line.substring(0, commaIndex);
    const value = line.substring(commaIndex + 1);

    // Handle tombstone records (null values)
    return { key, value: value === "null" ? null : value };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Search for a key in an SSTable using sparse index.
 * The sparse index tells us where to start searching from.
 */
async function searchSSTable(
  sstablePath: string,
  key: string,
): Promise<string | null | undefined> {
  const sparseIndex = sparseIndices.get(sstablePath);

  if (!sparseIndex || sparseIndex.length === 0) {
    // Fallback: build dense index if sparse index doesn't exist
    const index = await getSegmentIndex(sstablePath);
    const offset = index.get(key);
    if (offset !== undefined) {
      const record = await readRecordAtOffset(sstablePath, offset);
      return record?.value;
    }
    return undefined;
  }

  // Binary search in sparse index to find starting point
  let startOffset = 0;
  let endOffset = -1; // -1 means read to EOF

  for (let i = 0; i < sparseIndex.length; i++) {
    const entry = sparseIndex[i];

    if (entry.key === key) {
      // Exact match in sparse index
      const record = await readRecordAtOffset(sstablePath, entry.offset);
      if (record && record.key === key) {
        return record.value;
      }
    }

    if (entry.key <= key) {
      startOffset = entry.offset;
    }

    if (entry.key > key) {
      endOffset = entry.offset;
      break;
    }
  }

  // Scan from startOffset to endOffset (or EOF) looking for the key
  try {
    const file = await Deno.open(sstablePath, { read: true });
    await file.seek(startOffset, Deno.SeekMode.Start);

    const decoder = new TextDecoder();
    let buffer = "";
    let currentOffset = startOffset;

    const chunk = new Uint8Array(1024); // Read in 1KB chunks
    while (true) {
      const bytesRead = await file.read(chunk);
      if (bytesRead === null) break; // EOF

      buffer += decoder.decode(chunk.subarray(0, bytesRead), { stream: true });
      const lines = buffer.split("\n");

      // Keep last incomplete line in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "") continue;

        const commaIndex = line.indexOf(",");
        if (commaIndex !== -1) {
          const recordKey = line.substring(0, commaIndex);

          // Since SSTable is sorted, if we've passed the key, it doesn't exist
          if (recordKey > key) {
            file.close();
            return undefined;
          }

          if (recordKey === key) {
            const value = line.substring(commaIndex + 1);
            file.close();
            return value === "null" ? null : value;
          }
        }

        currentOffset += new TextEncoder().encode(line + "\n").length;

        // Stop if we've reached endOffset
        if (endOffset !== -1 && currentOffset >= endOffset) {
          file.close();
          return undefined;
        }
      }
    }

    file.close();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return undefined;
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

  // Initialize an empty index for the new segment
  segmentIndices.set(newSegmentPath, new Map());

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
 * Compact multiple SSTables by merging them in sorted order.
 * Removes stale and deleted records, keeping only the latest value for each key.
 * Creates a new sorted SSTable with a sparse index.
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

  // Sort by key and remove tombstones
  const sortedEntries = Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Write compacted data to a temporary file with sparse index
  const firstSegmentPath = segmentPaths[0];
  const tempPath = `${firstSegmentPath}.compact.tmp`;

  const sparseIndex: SparseIndex = [];
  let offset = 0;
  let content = "";

  for (let i = 0; i < sortedEntries.length; i++) {
    const [key, value] = sortedEntries[i];
    const line = `${key},${value}\n`;

    // Add to sparse index every 10th record
    if (i % DEFAULT_SPARSE_INDEX_DENSITY === 0) {
      sparseIndex.push({ key, offset });
    }

    content += line;
    offset += new TextEncoder().encode(line).length;
  }

  await Deno.writeTextFile(tempPath, content);

  // Another small delay before file operations
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Clear indices for segments that will be deleted
  for (const segmentPath of segmentPaths) {
    clearSegmentIndex(segmentPath);
    sparseIndices.delete(segmentPath);
  }

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

  // Store the sparse index for the compacted segment
  sparseIndices.set(firstSegmentPath, sparseIndex);
}

/**
 * Get the current file size in bytes.
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileInfo = await Deno.stat(filePath);
    return fileInfo.size;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 0;
    }
    throw error;
  }
}

/**
 * Flush memtable to disk as a sorted SSTable.
 * Creates a sparse index for efficient lookups.
 */
async function flushMemtable(
  dbPath: string,
  memtable: Memtable,
  config?: DbConfig,
): Promise<string> {
  const segments = await listSegments(dbPath);

  // Get the highest segment ID and increment it
  const segmentIds = segments.map((path) => {
    const match = path.match(/\.(\d+)\.db$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  const maxId = segmentIds.length > 0 ? Math.max(...segmentIds) : -1;
  const nextSegmentId = maxId + 1;
  const sstablePath = getSegmentPath(dbPath, nextSegmentId);

  // Get sorted entries from memtable
  const entries = memtable.getSortedEntries();

  // Write sorted data to SSTable and build sparse index
  const sparseIndexDensity = config?.sparseIndexDensity ??
    DEFAULT_SPARSE_INDEX_DENSITY;
  const sparseIndex: SparseIndex = [];
  let offset = 0;

  let content = "";
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    const line = `${key},${value}\n`;

    // Add to sparse index every N records
    if (i % sparseIndexDensity === 0) {
      sparseIndex.push({ key, offset });
    }

    content += line;
    offset += new TextEncoder().encode(line).length;
  }

  await Deno.writeTextFile(sstablePath, content);

  // Store the sparse index
  sparseIndices.set(sstablePath, sparseIndex);

  return sstablePath;
}

/**
 * Append a record to the active segment, rotating if necessary.
 * Updates the index with the new record's offset.
 */
async function appendRecord(
  dbPath: string,
  record: Record,
  config?: DbConfig,
): Promise<void> {
  const maxRecords = config?.maxSegmentRecords ?? DEFAULT_MAX_SEGMENT_RECORDS;
  const activeSegment = await getActiveSegment(dbPath);
  const recordCount = await countRecords(activeSegment);

  const line = `${record.key},${record.value}\n`;

  // Check if we need to rotate
  if (recordCount >= maxRecords) {
    const newSegmentPath = await rotateSegment(dbPath);
    // Get the offset before writing (should be 0 for new segment)
    const offset = await getFileSize(newSegmentPath);
    await Deno.writeTextFile(newSegmentPath, line, { append: true });
    // Update index with the new record
    updateSegmentIndex(newSegmentPath, record.key, offset);
  } else {
    // Get the offset before writing
    const offset = await getFileSize(activeSegment);
    await Deno.writeTextFile(activeSegment, line, { append: true });
    // Update index with the new record
    updateSegmentIndex(activeSegment, record.key, offset);
  }
}

/**
 * Set a key-value pair in the database.
 * Writes to memtable first, then flushes to disk when full.
 */
export async function set(
  dbPath: string,
  key: string,
  value: string,
  config?: DbConfig,
): Promise<void> {
  const maxMemtableRecords = config?.maxMemtableRecords ??
    DEFAULT_MAX_MEMTABLE_RECORDS;

  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  // Write to WAL first for crash recovery
  await appendToWAL(dbPath, key, value);

  // Write to memtable
  memtable.set(key, value);

  // Check if memtable needs to be flushed
  if (memtable.size() >= maxMemtableRecords) {
    // Flush memtable to disk as sorted SSTable
    await flushMemtable(dbPath, memtable, config);

    // Clear memtable and WAL
    memtable.clear();
    await clearWAL(dbPath);

    // Trigger compaction if needed
    const segments = await listSegments(dbPath);
    if (segments.length >= 4) {
      const segmentsToCompact = segments.slice(0, -1);
      try {
        await compactSegments(dbPath, segmentsToCompact);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Compaction error: ${message}`);
      }
    }
  }
}

/**
 * Get a value by key from the database.
 * Checks memtable first, then SSTables from newest to oldest.
 * Returns null if the key doesn't exist or was deleted (tombstone).
 */
export async function get(
  dbPath: string,
  key: string,
): Promise<string | null> {
  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  // 1. Check memtable first (most recent writes)
  if (memtable.has(key)) {
    return memtable.get(key) ?? null;
  }

  // 2. Search SSTables from newest to oldest
  const segments = await listSegments(dbPath);

  for (let i = segments.length - 1; i >= 0; i--) {
    const segmentPath = segments[i];
    const value = await searchSSTable(segmentPath, key);

    if (value !== undefined) {
      return value;
    }
  }

  // Key not found
  return null;
}

/**
 * Delete a key-value pair from the database.
 * Uses tombstone approach: writes a record with null value to memtable.
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

  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  const maxMemtableRecords = config?.maxMemtableRecords ??
    DEFAULT_MAX_MEMTABLE_RECORDS;

  // Write tombstone to WAL
  await appendToWAL(dbPath, key, null);

  // Write tombstone to memtable
  memtable.set(key, null);

  // Check if memtable needs to be flushed
  if (memtable.size() >= maxMemtableRecords) {
    await flushMemtable(dbPath, memtable, config);
    memtable.clear();
    await clearWAL(dbPath);

    // Trigger compaction if needed
    const segments = await listSegments(dbPath);
    if (segments.length >= 4) {
      const segmentsToCompact = segments.slice(0, -1);
      try {
        await compactSegments(dbPath, segmentsToCompact);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Compaction error: ${message}`);
      }
    }
  }

  return true;
}

/**
 * List all keys in the database.
 * Only returns keys that have non-null values (excludes tombstones and duplicates).
 */
export async function keys(dbPath: string): Promise<string[]> {
  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  const records = await readAllRecords(dbPath);
  const keyMap = new Map<string, string | null>();

  // Add memtable entries first (most recent)
  for (const [key, value] of memtable.getSortedEntries()) {
    keyMap.set(key, value);
  }

  // Add disk records (older data)
  for (const record of records) {
    if (!keyMap.has(record.key)) {
      keyMap.set(record.key, record.value);
    }
  }

  // Return only keys with non-null values, sorted
  return Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .map(([key, _]) => key)
    .sort();
}

/**
 * Get all key-value pairs in the database.
 * Only returns records with non-null values (excludes tombstones and duplicates).
 */
export async function all(dbPath: string): Promise<Record[]> {
  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  const records = await readAllRecords(dbPath);
  const keyMap = new Map<string, string | null>();

  // Add memtable entries first (most recent)
  for (const [key, value] of memtable.getSortedEntries()) {
    keyMap.set(key, value);
  }

  // Add disk records (older data)
  for (const record of records) {
    if (!keyMap.has(record.key)) {
      keyMap.set(record.key, record.value);
    }
  }

  // Return only entries with non-null values, sorted by key
  return Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }));
}

/**
 * Range query: get all key-value pairs where start <= key < end.
 * If start is undefined, starts from the beginning.
 * If end is undefined, goes to the end.
 * Returns records sorted by key.
 */
export async function range(
  dbPath: string,
  start?: string,
  end?: string,
): Promise<Record[]> {
  // Get the memtable for this database
  const memtable = await getMemtable(dbPath);

  const keyMap = new Map<string, string | null>();

  // 1. Get range from memtable
  const memtableEntries = memtable.range(start, end);
  for (const [key, value] of memtableEntries) {
    keyMap.set(key, value);
  }

  // 2. Get range from SSTables (newest to oldest)
  const segments = await listSegments(dbPath);

  for (let i = segments.length - 1; i >= 0; i--) {
    const segmentPath = segments[i];
    const segmentRecords = await readSegmentRecords(segmentPath);

    for (const record of segmentRecords) {
      // Check if key is in range
      if (start && record.key < start) continue;
      if (end && record.key >= end) continue;

      // Only add if not already in keyMap (newer values take precedence)
      if (!keyMap.has(record.key)) {
        keyMap.set(record.key, record.value);
      }
    }
  }

  // Return only entries with non-null values, sorted by key
  return Array.from(keyMap.entries())
    .filter(([_, value]) => value !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }));
}
