import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { delimiter, join } from "node:path";

const dir = fileURLToPath(new URL("../data/aviator/", import.meta.url));
export function runAviator(
  expression: string,
  input: Record<string, unknown>,
  mapping?: { param: string; source: string },
) {
  if (
    typeof expression !== "string" ||
    !expression.trim() ||
    expression.length > 65536
  )
    throw Error("请输入 1 至 65536 字符的 Aviator 表达式");
  if (!existsSync(join(dir, "java-path")))
    throw Error("Aviator 运行时尚未安装，请执行 npm run setup:aviator");
  const java = readFileSync(join(dir, "java-path"), "utf8").trim();
  const cp = [
    dir,
    join(dir, "aviator-5.4.4.jar"),
    join(dir, "gson-2.13.2.jar"),
  ].join(delimiter);
  const run = spawnSync(
    java,
    [
      "-Xms8m",
      "-Xmx48m",
      "-XX:+ExitOnOutOfMemoryError",
      "-Dfile.encoding=UTF-8",
      "-cp",
      cp,
      "LocalAviator",
    ],
    {
      cwd: dir,
      env: { LANG: "en_US.UTF-8" },
      input: JSON.stringify({ expression, input, mapping }),
      encoding: "utf8",
      timeout: 3500,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    },
  );
  if (run.error || run.status !== 0)
    throw Error("Aviator 执行超时或运行时不可用");
  const result = JSON.parse(run.stdout);
  if ("error" in result) throw Error("Aviator：" + result.error);
  return result.value;
}
