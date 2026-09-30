import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { file, sleep, spawn } from "bun";

const API = "https://deploy.balkhaev.com/api/v1";
const HOST = "root@49.13.216.63";
const IMAGE = "127.0.0.1:5000/balkhaev-site";
const token = process.env.COOLIFY_ACCESS_TOKEN;
if (!token) {
  throw new Error("Set COOLIFY_ACCESS_TOKEN before deploying");
}

async function run(argv: string[], stdin?: Blob) {
  const child = spawn(argv, {
    stderr: "inherit",
    stdin: stdin ?? "ignore",
    stdout: "inherit",
  });
  if ((await child.exited) !== 0) {
    throw new Error(`${argv[0]} failed`);
  }
}

async function request<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    method,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Coolify ${method} ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

const revision = spawn(["git", "rev-parse", "HEAD"], {
  stderr: "inherit",
  stdout: "pipe",
});
const commit = (await new Response(revision.stdout).text()).trim();
if ((await revision.exited) !== 0 || !/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error("Commit the site before deploying");
}
const config = (await file(
  new URL("../deploy/coolify.json", import.meta.url)
).json()) as { application: string };
const archive = join(tmpdir(), `balkhaev-site-${commit}.tar`);
const buildDir = `/tmp/balkhaev-site-${commit}`;
try {
  await run(["git", "archive", "--format=tar", `--output=${archive}`, commit]);
  await run(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      HOST,
      `mkdir -p ${buildDir} && tar -xf - -C ${buildDir}`,
    ],
    file(archive)
  );
  const script = [
    "set -eu",
    `docker build -t ${IMAGE}:${commit} ${buildDir}`,
    `docker push ${IMAGE}:${commit}`,
    `docker tag ${IMAGE}:${commit} ${IMAGE}:prod`,
    `docker push ${IMAGE}:prod`,
    `rm -rf -- ${buildDir}`,
  ].join("\n");
  await run(
    ["ssh", "-o", "BatchMode=yes", HOST, "bash -s"],
    new Blob([script])
  );
} finally {
  await unlink(archive);
}
const started = await request<{ deployments?: { deployment_uuid: string }[] }>(
  `/deploy?uuid=${encodeURIComponent(config.application)}&force=true`,
  "POST"
);
const deployment = started.deployments?.[0]?.deployment_uuid;
if (!deployment) {
  throw new Error("Coolify did not queue the deployment");
}
const deadline = Date.now() + 10 * 60_000;
let finished = false;
while (Date.now() < deadline) {
  // biome-ignore lint/performance/noAwaitInLoops: serial deployment status polling
  await sleep(5000);
  const { status } = await request<{ status: string }>(
    `/deployments/${deployment}`
  );
  if (status === "finished") {
    finished = true;
    break;
  }
  if (status === "failed" || status === "cancelled-by-user") {
    throw new Error(`Deployment ${status}`);
  }
}
if (!finished) {
  throw new Error("Deployment timed out");
}
process.stdout.write(`Deployed ${commit} to https://balkhaev.com\n`);
