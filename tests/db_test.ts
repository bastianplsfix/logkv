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
