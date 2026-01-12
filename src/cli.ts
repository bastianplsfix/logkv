import { parseArgs } from "@std/cli/parse-args";
import * as db from "./db.ts";

const VERSION = "0.1.0";

export async function runCLI(args: string[]) {
  const parsedArgs = parseArgs(args, {
    boolean: ["help", "version", "verbose", "json"],
    string: ["db-path"],
    alias: {
      h: "help",
      v: "version",
      d: "db-path",
      V: "verbose",
      j: "json",
    },
    default: {
      "db-path": "./data.db",
      verbose: false,
      json: false,
    },
  });

  if (parsedArgs.version) {
    console.log(`LogKv v${VERSION}`);
    return 0;
  }

  if (parsedArgs.help) {
    printUsage();
    return 0;
  }

  if (parsedArgs._.length === 0) {
    console.error(
      "%cError:%c No command provided",
      "color: red; font-weight: bold",
      "",
    );
    console.error("\nRun 'logkv --help' for usage information");
    return 1;
  }

  const dbPath = parsedArgs["db-path"];
  const command = String(parsedArgs._[0]);

  try {
    switch (command) {
      case "set": {
        if (parsedArgs._.length < 3) {
          console.error(
            "%cError:%c 'set' requires a key and value",
            "color: red; font-weight: bold",
            "",
          );
          console.error("\nUsage: logkv set <key> <value>");
          return 1;
        }
        const key = String(parsedArgs._[1]);
        const value = String(parsedArgs._[2]);

        await db.set(dbPath, key, value);

        if (parsedArgs.json) {
          console.log(JSON.stringify({ success: true, key, value }));
        } else {
          console.log(
            `%c✓%c Set '%c${key}%c' = '%c${value}%c'`,
            "color: green; font-weight: bold",
            "",
            "color: cyan",
            "",
            "color: yellow",
            "",
          );
        }
        return 0;
      }

      case "get": {
        if (parsedArgs._.length < 2) {
          console.error(
            "%cError:%c 'get' requires a key",
            "color: red; font-weight: bold",
            "",
          );
          console.error("\nUsage: logkv get <key>");
          return 1;
        }
        const key = String(parsedArgs._[1]);
        const value = await db.get(dbPath, key);

        if (value !== null) {
          if (parsedArgs.json) {
            console.log(JSON.stringify({ success: true, key, value }));
          } else {
            console.log(value);
          }
          return 0;
        } else {
          if (parsedArgs.json) {
            console.log(
              JSON.stringify({ success: false, error: "Key not found" }),
            );
          } else {
            console.error(
              `%cError:%c Key '%c${key}%c' not found`,
              "color: red; font-weight: bold",
              "",
              "color: cyan",
              "",
            );
          }
          return 1;
        }
      }

      case "delete":
      case "del":
      case "rm": {
        if (parsedArgs._.length < 2) {
          console.error(
            "%cError:%c 'delete' requires a key",
            "color: red; font-weight: bold",
            "",
          );
          console.error("\nUsage: logkv delete <key>");
          return 1;
        }
        const key = String(parsedArgs._[1]);
        const deleted = await db.del(dbPath, key);

        if (deleted) {
          if (parsedArgs.json) {
            console.log(JSON.stringify({ success: true, key, deleted: true }));
          } else {
            console.log(
              `%c✓%c Deleted '%c${key}%c'`,
              "color: green; font-weight: bold",
              "",
              "color: cyan",
              "",
            );
          }
          return 0;
        } else {
          if (parsedArgs.json) {
            console.log(
              JSON.stringify({ success: false, error: "Key not found" }),
            );
          } else {
            console.error(
              `%cError:%c Key '%c${key}%c' not found`,
              "color: red; font-weight: bold",
              "",
              "color: cyan",
              "",
            );
          }
          return 1;
        }
      }

      case "keys":
      case "ls": {
        const keys = await db.keys(dbPath);

        if (parsedArgs.json) {
          console.log(
            JSON.stringify({ success: true, keys, count: keys.length }),
          );
        } else {
          if (keys.length === 0) {
            console.log("No keys found");
          } else {
            if (parsedArgs.verbose) {
              console.log(
                `Found %c${keys.length}%c key${keys.length === 1 ? "" : "s"}:`,
                "color: cyan; font-weight: bold",
                "",
              );
            }
            keys.forEach((key) => console.log(`  ${key}`));
          }
        }
        return 0;
      }

      case "all":
      case "list": {
        const records = await db.all(dbPath);

        if (parsedArgs.json) {
          console.log(
            JSON.stringify({ success: true, records, count: records.length }),
          );
        } else {
          if (records.length === 0) {
            console.log("Database is empty");
          } else {
            if (parsedArgs.verbose) {
              console.log(
                `Found %c${records.length}%c record${
                  records.length === 1 ? "" : "s"
                }:`,
                "color: cyan; font-weight: bold",
                "",
              );
            }
            records.forEach((record) => {
              console.log(
                `  %c${record.key}%c = %c${record.value}%c`,
                "color: cyan",
                "",
                "color: yellow",
                "",
              );
            });
          }
        }
        return 0;
      }

      default:
        console.error(
          `%cError:%c Unknown command '%c${command}%c'`,
          "color: red; font-weight: bold",
          "",
          "color: cyan",
          "",
        );
        printUsage();
        return 1;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    if (parsedArgs.json) {
      console.error(JSON.stringify({ success: false, error: errorMessage }));
    } else {
      console.error(
        `%cError:%c ${errorMessage}`,
        "color: red; font-weight: bold",
        "",
      );
      if (parsedArgs.verbose && errorStack) {
        console.error("\nStack trace:");
        console.error(errorStack);
      }
    }
    return 1;
  }
}

function printUsage() {
  console.log(
    `
%cLogKv%c - A simple key-value database

%cUSAGE:%c
  logkv [OPTIONS] <COMMAND> [ARGS]

%cOPTIONS:%c
  -h, --help              Show this help message
  -v, --version           Show version information
  -d, --db-path <PATH>    Path to database file (default: ./data.db)
  -V, --verbose           Enable verbose output
  -j, --json              Output results in JSON format

%cCOMMANDS:%c
  set <key> <value>       Set a key-value pair
  get <key>               Get the value for a key
  delete|del|rm <key>     Delete a key-value pair
  keys|ls                 List all keys
  all|list                List all key-value pairs

%cEXAMPLES:%c
  logkv set hello world
  logkv get hello
  logkv delete hello
  logkv --db-path ./custom.db set foo bar
  logkv --json get foo
  logkv --verbose all
`,
    "color: cyan; font-weight: bold",
    "",
    "color: yellow; font-weight: bold",
    "",
    "color: yellow; font-weight: bold",
    "",
    "color: yellow; font-weight: bold",
    "",
    "color: yellow; font-weight: bold",
    "",
  );
}
