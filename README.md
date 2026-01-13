# LogKv (in progress)

A simple key-value database built from scratch following
[nan.fyi/database](https://www.nan.fyi/database).

## Usage

**Terminal 1 – Auto-compile on changes:**

```bash
deno task compile:watch
```

**Terminal 2 – Use the binary (local):**

```bash
./logkv set hello world
./logkv get hello
./logkv --help
```

---

## Global command (optional, recommended)

Create a symlink so you can run `logkv` from anywhere.

### Add symlink

```bash
ln -sf "$PWD/logkv" ~/.local/bin/logkv
```

Now you can run from anywhere:

```bash
logkv set hello world
logkv get hello
```

Your watcher will keep rebuilding `./logkv` and the symlink will always point to the latest binary.

---

### Remove symlink (cleanup)

```bash
rm ~/.local/bin/logkv
```

---

## Commands

```
set <key> <value>       Set a key-value pair
get <key>               Get value by key
delete <key>            Delete a key
keys                    List all keys
all                     List all records
```

---

## How It Works

Append-only file-based storage with segments and compaction:

- **Append-only writes**: Updates and deletes append new records (tombstones for deletes)
- **Immutable records**: Old data remains until compaction
- **Segment rotation**: Files split into segments when reaching size limit
- **Background compaction**: Old segments are merged, removing stale/deleted data
- **Multi-segment reads**: Queries scan all segments, returning latest values

### Segment Size Configuration

Control when files rotate using the `--segment-size` (or `-s`) option:

```bash
# Use small segment size for testing (rotates every 5 records)
./logkv --segment-size 5 set key1 value1

# Default is 1000 records per segment
./logkv set key1 value1
```

### Storage Format

Each segment stores records in CSV format:

```
key1,value1
key2,value2
key3,null          # tombstone (deleted)
key1,updated1      # update creates new record
```

Segments are named: `data.db`, `data.1.db`, `data.2.db`, etc.
