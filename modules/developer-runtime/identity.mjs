// The canonical repository resolver now lives in modules/repositories. Runtime consumes it
// rather than owning the implementation (canonical-repository-identity plan, migration step 15).
// This re-export preserves Runtime's existing public identity surface exactly.
export {
  normalizeGitRemote,
  findProjectRoot,
  resolveProjectIdentity,
} from "../repositories/identity.mjs";
