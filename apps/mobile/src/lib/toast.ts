type ToastKind = "error" | "info";

export type ToastMessage = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();
let nextId = 1;

function emit(kind: ToastKind, message: string) {
  const toast = { id: nextId, kind, message };
  nextId += 1;
  console[kind === "error" ? "error" : "info"](`[Inkwell] ${message}`);
  listeners.forEach((listener) => listener(toast));
}

export function showError(message: string) {
  emit("error", message);
}

export function showInfo(message: string) {
  emit("info", message);
}

export function subscribeToToasts(listener: ToastListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
