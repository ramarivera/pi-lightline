import type { PiApi } from "./extension.ts";
import { createExtension } from "./extension.ts";

export {
  createExtension,
  extensionInfo,
  getPromptHistory,
  readShellHistory,
} from "./extension.ts";

export default async function lightline(pi: PiApi) {
  await createExtension().activate(pi);
}
