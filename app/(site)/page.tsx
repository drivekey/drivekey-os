import { readFile } from "node:fs/promises";
import path from "node:path";
import TerminalLanding from "@/components/site/terminal-landing";

export default async function Page() {
  const wordmark = await readFile(path.join(process.cwd(), "public/brand/wordmark.txt"), "utf8");
  return <TerminalLanding wordmark={wordmark}/>;
}
