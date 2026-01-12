import { runCLI } from "./cli.ts";

if (import.meta.main) {
  const exitCode = await runCLI(Deno.args);
  Deno.exit(exitCode);
}
