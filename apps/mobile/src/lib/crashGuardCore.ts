// Dependency-free crash guard core. crashGuardEntry imports this before
// expo-router/entry. Native persistence is resolved lazily so failures while
// loading expo-file-system itself are still observed by the global handler.

export type FatalReport = {
  message: string;
  stack: string | null;
  occurredAt: string;
  /** False means the crash happened before the UI mounted (startup crash). */
  uiWasMounted: boolean;
};

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

type CrashFile = {
  readonly exists: boolean;
  write: (contents: string) => void;
  textSync: () => string;
  delete: () => void;
};

type FileSystemModule = {
  File: new (base: unknown, ...paths: string[]) => CrashFile;
  Paths: { readonly document: unknown };
};

const crashFile = (): CrashFile => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require("expo-file-system") as FileSystemModule;
  return new File(Paths.document, "inkwell-last-fatal.json");
};

let liveListener: ((report: FatalReport) => void) | null = null;

export function toFatalReport(
  error: unknown,
  uiWasMounted: boolean,
): FatalReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    message: err.name ? `${err.name}: ${err.message}` : err.message,
    stack: err.stack ?? null,
    occurredAt: new Date().toISOString(),
    uiWasMounted,
  };
}

/** Best-effort and synchronous because it may run while the app is dying. */
export function persistFatalReport(report: FatalReport) {
  try {
    crashFile().write(JSON.stringify(report));
  } catch {
    // Never let the guard itself throw.
  }
}

export function readLastFatalReportText(): string | null {
  try {
    const file = crashFile();
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

export function clearLastFatalReport() {
  try {
    const file = crashFile();
    if (file.exists) file.delete();
  } catch {
    // Stale report just shows once more; harmless.
  }
}

export function setFatalErrorListener(
  listener: ((report: FatalReport) => void) | null,
) {
  liveListener = listener;
}

export function installCrashGuard() {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) return;
  const defaultHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      const report = toFatalReport(error, liveListener != null);
      persistFatalReport(report);
      if (!__DEV__ && liveListener) {
        liveListener(report);
        return;
      }
    }
    defaultHandler(error, isFatal);
  });
}
