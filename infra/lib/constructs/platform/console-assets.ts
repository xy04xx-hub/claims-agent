// Owner: B (muzair110)
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ConsoleAssets {
  dir: string;
  isPlaceholder: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE is <repo>/infra/lib/constructs/platform, so the repo root is four levels up.
const REPO_ROOT = path.resolve(HERE, '../../../..');

/** Built console from the frontend workspace. */
export const FRONTEND_DIST: string = path.join(REPO_ROOT, 'frontend', 'dist');
/** Committed placeholder page, deployed when the console is not built. */
export const PLACEHOLDER_DIR: string = path.join(REPO_ROOT, 'infra', 'assets', 'web-placeholder');

/**
 * Picks the directory the Console_Deployment uploads: the built console when
 * `index.html` exists in it, otherwise the placeholder.
 */
export function resolveConsoleAssetDir(
  frontendDist: string,
  placeholder: string,
  fileExists: (p: string) => boolean,
): ConsoleAssets {
  if (fileExists(path.join(frontendDist, 'index.html'))) {
    return { dir: frontendDist, isPlaceholder: false };
  }
  return { dir: placeholder, isPlaceholder: true };
}
