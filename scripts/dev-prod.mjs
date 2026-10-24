import { spawn } from "node:child_process";

const wranglerArgs = [
  "exec",
  "wrangler",
  "dev",
  "-c",
  "wrangler.jsonc",
  ...process.argv.slice(2),
];

const child = spawn("pnpm", wranglerArgs, {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    SITE_LOCAL_BUILD: process.env.SITE_LOCAL_BUILD ?? "1",
  },
});

child.stdout?.pipe(process.stdout);

let buffer = "";
let suppressing = false;

function processStderrChunk(chunk) {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (
      line.includes("NOSENTRY RPC connection broken") ||
      line.includes("capnp/serialize-async.c++")
    ) {
      suppressing = true;
      continue;
    }

    if (suppressing) {
      if (/^\s*(\/|[a-z0-9/._-]+workerd@[0-9a-f]+|stack:)/i.test(line)) {
        continue;
      }
      if (line.trim() === "") {
        suppressing = false;
        continue;
      }
      suppressing = false;
    }

    process.stderr.write(line + "\n");
  }
}

child.stderr?.on("data", processStderrChunk);

child.stderr?.on("end", () => {
  if (buffer && !suppressing) {
    process.stderr.write(buffer);
  }
});

const forwardSignal = (sig) => {
  if (child.pid) child.kill(sig);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("close", (code) => {
  process.exit(code ?? 0);
});
