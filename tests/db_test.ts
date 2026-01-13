import { assertEquals } from "@std/assert";
import * as db from "../src/db.ts";

Deno.test("db - set and get", async () => {
  const testDbPath = "./test_data.db";

  try {
    await db.set(testDbPath, "test_key", "test_value");
    const value = await db.get(testDbPath, "test_key");
    assertEquals(value, "test_value");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - get non-existent key", async () => {
  const testDbPath = "./test_data_nonexistent.db";

  try {
    const value = await db.get(testDbPath, "nonexistent");
    assertEquals(value, null);
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - update existing key", async () => {
  const testDbPath = "./test_data_update.db";

  try {
    await db.set(testDbPath, "update_key", "old_value");
    await db.set(testDbPath, "update_key", "new_value");
    const value = await db.get(testDbPath, "update_key");
    assertEquals(value, "new_value");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - delete key", async () => {
  const testDbPath = "./test_data_delete.db";

  try {
    await db.set(testDbPath, "delete_key", "delete_value");
    const deleted = await db.del(testDbPath, "delete_key");
    assertEquals(deleted, true);

    const value = await db.get(testDbPath, "delete_key");
    assertEquals(value, null);
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - delete non-existent key", async () => {
  const testDbPath = "./test_data_delete_nonexistent.db";

  try {
    const deleted = await db.del(testDbPath, "nonexistent");
    assertEquals(deleted, false);
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - list keys", async () => {
  const testDbPath = "./test_data_keys.db";

  try {
    await db.set(testDbPath, "key1", "value1");
    await db.set(testDbPath, "key2", "value2");
    await db.set(testDbPath, "key3", "value3");

    const keys = await db.keys(testDbPath);
    assertEquals(keys.length, 3);
    assertEquals(keys.includes("key1"), true);
    assertEquals(keys.includes("key2"), true);
    assertEquals(keys.includes("key3"), true);
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - get all records", async () => {
  const testDbPath = "./test_data_all.db";

  try {
    await db.set(testDbPath, "a", "alpha");
    await db.set(testDbPath, "b", "beta");

    const all = await db.all(testDbPath);
    assertEquals(all.length, 2);
    assertEquals(all.find((r) => r.key === "a")?.value, "alpha");
    assertEquals(all.find((r) => r.key === "b")?.value, "beta");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - handle values with commas", async () => {
  const testDbPath = "./test_data_commas.db";

  try {
    await db.set(testDbPath, "csv_key", "value1,value2,value3");
    const value = await db.get(testDbPath, "csv_key");
    assertEquals(value, "value1,value2,value3");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - empty database", async () => {
  const testDbPath = "./test_data_empty.db";

  try {
    const keys = await db.keys(testDbPath);
    assertEquals(keys.length, 0);

    const all = await db.all(testDbPath);
    assertEquals(all.length, 0);
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - append-only: updates append new records", async () => {
  const testDbPath = "./test_data_append.db";

  try {
    await db.set(testDbPath, "key1", "value1");
    await db.set(testDbPath, "key1", "value2");
    await db.set(testDbPath, "key1", "value3");

    // Should return the last value
    const value = await db.get(testDbPath, "key1");
    assertEquals(value, "value3");

    // File should contain all three records
    const content = await Deno.readTextFile(testDbPath);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[0], "key1,value1");
    assertEquals(lines[1], "key1,value2");
    assertEquals(lines[2], "key1,value3");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - append-only: deletes use tombstones", async () => {
  const testDbPath = "./test_data_tombstone.db";

  try {
    await db.set(testDbPath, "key1", "value1");
    await db.del(testDbPath, "key1");

    // Should return null (deleted)
    const value = await db.get(testDbPath, "key1");
    assertEquals(value, null);

    // File should contain both records (original + tombstone)
    const content = await Deno.readTextFile(testDbPath);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
    assertEquals(lines[0], "key1,value1");
    assertEquals(lines[1], "key1,null");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

Deno.test("db - append-only: can resurrect deleted keys", async () => {
  const testDbPath = "./test_data_resurrect.db";

  try {
    await db.set(testDbPath, "key1", "value1");
    await db.del(testDbPath, "key1");
    await db.set(testDbPath, "key1", "value2");

    // Should return the resurrected value
    const value = await db.get(testDbPath, "key1");
    assertEquals(value, "value2");

    // File should contain all three records
    const content = await Deno.readTextFile(testDbPath);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 3);
    assertEquals(lines[0], "key1,value1");
    assertEquals(lines[1], "key1,null");
    assertEquals(lines[2], "key1,value2");
  } finally {
    try {
      await Deno.remove(testDbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
});

// Helper function to clean up all segment files
async function cleanupSegments(dbPath: string) {
  const dir = dbPath.includes("/")
    ? dbPath.substring(0, dbPath.lastIndexOf("/"))
    : ".";
  const base = dbPath.includes("/")
    ? dbPath.substring(dbPath.lastIndexOf("/") + 1)
    : dbPath;
  const baseName = base.includes(".")
    ? base.substring(0, base.lastIndexOf("."))
    : base;

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.startsWith(baseName)) {
        try {
          await Deno.remove(`${dir}/${entry.name}`);
        } catch {
          // Ignore errors
        }
      }
    }
  } catch {
    // Ignore if dir doesn't exist
  }
}

Deno.test("segments - rotation at size limit", async () => {
  const testDbPath = "./test_segments_rotation.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add 7 records with segment size of 3
    for (let i = 1; i <= 7; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Should create multiple segments
    const segments: string[] = [];
    for await (const entry of Deno.readDir(".")) {
      if (entry.name.startsWith("test_segments_rotation")) {
        segments.push(entry.name);
      }
    }

    // Should have at least 2 segments (main + rotated)
    assertEquals(segments.length >= 2, true);

    // All records should be readable
    for (let i = 1; i <= 7; i++) {
      const value = await db.get(testDbPath, `key${i}`);
      assertEquals(value, `value${i}`);
    }
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - reads across multiple segments", async () => {
  const testDbPath = "./test_segments_reads.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add 10 records, triggering multiple rotations
    for (let i = 1; i <= 10; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Verify all records are readable
    const allRecords = await db.all(testDbPath);
    assertEquals(allRecords.length, 10);

    for (let i = 1; i <= 10; i++) {
      const found = allRecords.find((r) => r.key === `key${i}`);
      assertEquals(found?.value, `value${i}`);
    }
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - updates across segments", async () => {
  const testDbPath = "./test_segments_updates.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add initial records
    await db.set(testDbPath, "key1", "value1", config);
    await db.set(testDbPath, "key2", "value2", config);
    await db.set(testDbPath, "key3", "value3", config);
    await db.set(testDbPath, "key4", "value4", config); // Triggers rotation

    // Update a key from the first segment
    await db.set(testDbPath, "key1", "updated1", config);

    // Should return updated value
    const value = await db.get(testDbPath, "key1");
    assertEquals(value, "updated1");
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - deletes across segments", async () => {
  const testDbPath = "./test_segments_deletes.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add records across multiple segments
    for (let i = 1; i <= 7; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Delete a key from an earlier segment
    const deleted = await db.del(testDbPath, "key2", config);
    assertEquals(deleted, true);

    // Should return null for deleted key
    const value = await db.get(testDbPath, "key2");
    assertEquals(value, null);

    // Other keys should still be accessible
    const value1 = await db.get(testDbPath, "key1");
    assertEquals(value1, "value1");
    const value3 = await db.get(testDbPath, "key3");
    assertEquals(value3, "value3");
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - compaction removes stale data", async () => {
  const testDbPath = "./test_segments_compaction.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add enough records to trigger compaction (need 4+ segments before rotation)
    for (let i = 1; i <= 13; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // All records should still be readable after compaction
    for (let i = 1; i <= 13; i++) {
      const value = await db.get(testDbPath, `key${i}`);
      assertEquals(value, `value${i}`, `key${i} should equal value${i}`);
    }

    // Count total segments (should be fewer than without compaction)
    const segments: string[] = [];
    for await (const entry of Deno.readDir(".")) {
      if (
        entry.name.startsWith("test_segments_compaction") &&
        entry.name.endsWith(".db")
      ) {
        segments.push(entry.name);
      }
    }

    // Should have compacted (fewer than 5 segments)
    assertEquals(
      segments.length < 5,
      true,
      `Should have fewer than 5 segments, got ${segments.length}`,
    );
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - compaction with updates and deletes", async () => {
  const testDbPath = "./test_segments_compact_updates.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Create stale data by updating and deleting
    await db.set(testDbPath, "key1", "value1", config);
    await db.set(testDbPath, "key2", "value2", config);
    await db.set(testDbPath, "key3", "value3", config);
    await db.set(testDbPath, "key1", "updated1", config); // Update creates stale record
    await db.set(testDbPath, "key4", "value4", config);
    await db.del(testDbPath, "key2", config); // Delete creates tombstone

    // Add more records to trigger compaction
    for (let i = 5; i <= 13; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Verify final state
    assertEquals(await db.get(testDbPath, "key1"), "updated1");
    assertEquals(await db.get(testDbPath, "key2"), null); // Deleted
    assertEquals(await db.get(testDbPath, "key3"), "value3");

    const allKeys = await db.keys(testDbPath);
    assertEquals(allKeys.includes("key1"), true);
    assertEquals(allKeys.includes("key2"), false); // Deleted key not in list
    assertEquals(allKeys.includes("key3"), true);
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - segment ID continuity after compaction", async () => {
  const testDbPath = "./test_segments_id_continuity.db";
  const config: db.DbConfig = { maxSegmentRecords: 3 };

  try {
    // Add enough records to trigger compaction
    for (let i = 1; i <= 16; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Check that all records are present
    for (let i = 1; i <= 16; i++) {
      const value = await db.get(testDbPath, `key${i}`);
      assertEquals(
        value,
        `value${i}`,
        `key${i} should be present after compaction`,
      );
    }

    // List all segments and check IDs are sequential without gaps creating overwrites
    const segments: string[] = [];
    for await (const entry of Deno.readDir(".")) {
      if (
        entry.name.startsWith("test_segments_id_continuity") &&
        entry.name.endsWith(".db")
      ) {
        segments.push(entry.name);
      }
    }

    // Verify no data loss
    const allRecords = await db.all(testDbPath);
    assertEquals(allRecords.length, 16, "All 16 records should be present");
  } finally {
    await cleanupSegments(testDbPath);
  }
});

Deno.test("segments - small segment size stress test", async () => {
  const testDbPath = "./test_segments_stress.db";
  const config: db.DbConfig = { maxSegmentRecords: 2 }; // Very small segments

  try {
    // Add many records with tiny segments
    for (let i = 1; i <= 25; i++) {
      await db.set(testDbPath, `key${i}`, `value${i}`, config);
    }

    // Verify all records
    for (let i = 1; i <= 25; i++) {
      const value = await db.get(testDbPath, `key${i}`);
      assertEquals(value, `value${i}`, `key${i} should be present`);
    }

    // Verify keys count
    const keys = await db.keys(testDbPath);
    assertEquals(keys.length, 25, "Should have all 25 keys");
  } finally {
    await cleanupSegments(testDbPath);
  }
});
