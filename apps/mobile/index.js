// Custom entry: the crash guard must install before any app code loads so
// fatal startup errors are recorded (and shown on the next launch) instead of
// the app closing with no trace. Import order matters here.
import "./src/lib/crashGuardEntry";
import "expo-router/entry";
