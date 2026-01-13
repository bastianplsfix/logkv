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

File-based storage using CSV format. Operations read entire file, modify in
memory, write back.

```
key1,value1
key2,value2
```

Simple but not optimized – future iterations will add indexing, append-only
logs, and compaction.
