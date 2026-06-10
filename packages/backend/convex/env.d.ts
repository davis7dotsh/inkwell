// Minimal typing for the `process.env` the Convex runtime provides to
// functions (this package deliberately has no @types/node). Multi-dot
// filenames are skipped by the Convex bundler, so this never deploys.
declare const process: {
  env: Record<string, string | undefined>;
};
