// Side-effect module: imported first from index.js so the global handler is
// in place before expo-router/entry pulls in the rest of the app.
import { installCrashGuard } from "./crashGuardCore";

installCrashGuard();
