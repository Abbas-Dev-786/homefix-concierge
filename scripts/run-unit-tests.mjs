import { rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const projectRoot = new URL("..", import.meta.url);
const root = projectRoot.pathname.replace(/^\//, "").replaceAll("/", "\\");
const outputDirectory = join(root, ".test-build");

rmSync(outputDirectory, { recursive: true, force: true });
try {
  const compiler = spawnSync(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.tests.json")],
    { cwd: root, stdio: "inherit" }
  );
  if (compiler.status !== 0) process.exit(compiler.status ?? 1);

  const testDirectory = join(outputDirectory, "test");
  const testFiles = readdirSync(testDirectory)
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => join(testDirectory, file));
  const runner = spawnSync(process.execPath, ["--test", ...testFiles], { cwd: root, stdio: "inherit" });
  process.exitCode = runner.status ?? 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
