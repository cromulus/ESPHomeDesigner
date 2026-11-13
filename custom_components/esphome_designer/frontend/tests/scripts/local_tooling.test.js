import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(__dirname, "../../../../../");
const temporary = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "designer-tooling-"));
  temporary.push(dir);
  return dir;
}
function executable(path, source) {
  writeFileSync(path, "#!/bin/sh\n" + source, { mode: 0o755 });
}
afterEach(() =>
  temporary
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

describe.skipIf(process.platform === "win32")("local quality tooling", () => {
  it("runs Python from the repo virtualenv even with a different active environment", () => {
    const dir = fixture();
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, ".venv/bin"), { recursive: true });
    mkdirSync(join(dir, "active/bin"), { recursive: true });
    copyFileSync(
      join(root, "scripts/run_python.cjs"),
      join(dir, "scripts/run_python.cjs"),
    );
    executable(join(dir, ".venv/bin/python"), 'printf "repo-python:%s" "$1"\n');
    executable(join(dir, "active/bin/python"), "exit 99\n");
    const result = spawnSync(
      process.execPath,
      [join(dir, "scripts/run_python.cjs"), "--version"],
      {
        env: { ...process.env, VIRTUAL_ENV: join(dir, "active") },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("repo-python:--version");
  });

  it.each([
    ["0", "verify:pre-push"],
    ["1", "verify:pre-push:skip-hassfest"],
  ])(
    "pre-push runs the checks and propagates failure with skip=%s",
    (skip, command) => {
      const dir = fixture();
      executable(join(dir, "git"), 'printf "%s" "$TEST_REPO"\n');
      executable(join(dir, "npm"), 'printf "%s %s" "$1" "$2"\nexit 17\n');
      const result = spawnSync("/bin/sh", [join(root, ".githooks/pre-push")], {
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          TEST_REPO: root,
          ESPHOME_DESIGNER_SKIP_HASSFEST: skip,
        },
        encoding: "utf8",
      });
      expect(result.stdout).toBe("run " + command);
      expect(result.status).toBe(17);
    },
  );
});
