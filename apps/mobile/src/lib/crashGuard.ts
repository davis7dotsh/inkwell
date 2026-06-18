import * as Effect from "effect/Effect";

import { decodeFatalReport } from "../effect/codecs";
import {
  clearLastFatalReport,
  persistFatalReport,
  readLastFatalReportText,
  setFatalErrorListener,
  toFatalReport,
  type FatalReport,
} from "./crashGuardCore";

export {
  clearLastFatalReport,
  persistFatalReport,
  setFatalErrorListener,
  toFatalReport,
  type FatalReport,
};

export const readLastFatalReport = Effect.suspend(() => {
  const json = readLastFatalReportText();
  return json
    ? decodeFatalReport(json).pipe(
        Effect.map((report): FatalReport => ({ ...report })),
      )
    : Effect.succeed(null);
});
