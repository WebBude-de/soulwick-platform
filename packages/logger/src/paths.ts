import { resolve } from "node:path";

/** Repository root (this file lives in packages/logger/src); relative LOG_DIRs start here. */
export const REPO_ROOT = resolve(import.meta.dir, "../../..");
