// Last-resort guard for fatal JS errors. Installed from the app entry
// (index.js) before any other app code loads, so even crashes during module
// initialization get recorded and shown on the next launch instead of the
// app silently vanishing. JS-level only — native segfaults bypass this; they
// need a native crash reporter.
import { File, Paths } from "expo-file-system";

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

const crashFile = () => new File(Paths.document, "inkwell-last-fatal.json");

let liveListener: ((report: FatalReport) => void) | null = null;

export function toFatalReport(error: unknown, uiWasMounted: boolean): FatalReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    message: err.name ? `${err.name}: ${err.message}` : err.message,
    stack: err.stack ?? null,
    occurredAt: new Date().toISOString(),
    uiWasMounted,
  };
}

/** Best-effort, synchronous — may run while the app is dying. */
export function persistFatalReport(report: FatalReport) {
  try {
    crashFile().write(JSON.stringify(report));
  } catch {
    // Never let the guard itself throw.
  }
}

export function readLastFatalReport(): FatalReport | null {
  try {
    const file = crashFile();
    if (!file.exists) return null;
    return JSON.parse(file.textSync()) as FatalReport;
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

/**
 * The root layout registers itself here. While a listener is mounted,
 * production fatal errors render the in-app diagnostic screen instead of
 * letting React Native abort the process.
 */
export function setFatalErrorListener(
  listener: ((report: FatalReport) => void) | null
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
      // No UI yet (or dev, where the RedBox is more useful): fall through to
      // the default handler; the persisted report surfaces on next launch.
    }
    defaultHandler(error, isFatal);
  });
}
