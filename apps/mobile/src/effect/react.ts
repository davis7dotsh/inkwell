import { useCallback, useEffect, useRef } from "react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { mobileRuntime, type MobileServices } from "./runtime";

type Handlers<A, E> = {
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: (error: E) => void;
  readonly onDefect?: (error: unknown) => void;
  readonly onInterrupt?: () => void;
};

type Outcome<A, E> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E };

export const runMobileEffect = <A, E>(
  effect: Effect.Effect<A, E, MobileServices>,
  handlers: Handlers<A, E> = {},
): (() => void) => {
  const handled = effect.pipe(
    Effect.match({
      onFailure: (error): Outcome<A, E> => ({ _tag: "Failure", error }),
      onSuccess: (value): Outcome<A, E> => ({ _tag: "Success", value }),
    }),
  );
  return mobileRuntime.runCallback(handled, {
    onExit: (exit) => {
      if (Exit.isSuccess(exit)) {
        if (exit.value._tag === "Success") {
          handlers.onSuccess?.(exit.value.value);
        } else {
          if (handlers.onFailure) handlers.onFailure(exit.value.error);
          else console.error("[Inkwell] Effect failed", exit.value.error);
        }
        return;
      }
      if (!Cause.hasInterruptsOnly(exit.cause)) {
        const error = Cause.squash(exit.cause);
        if (handlers.onDefect) handlers.onDefect(error);
        else console.error("[Inkwell] Effect defect", error);
      } else {
        handlers.onInterrupt?.();
      }
    },
  });
};

export const runMobileEffectSync = <A>(
  effect: Effect.Effect<A, never, MobileServices>,
): A => mobileRuntime.runSync(effect);

export const useMobileEffectRunner = () => {
  const cancellations = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      for (const cancel of cancellations.current) cancel();
      cancellations.current.clear();
    },
    [],
  );

  return useCallback(
    <A, E>(
      effect: Effect.Effect<A, E, MobileServices>,
      handlers: Handlers<A, E> = {},
    ) => {
      let completed = false;
      let cancel = () => {};
      const finish = () => {
        completed = true;
        cancellations.current.delete(cancel);
      };
      cancel = runMobileEffect(effect, {
        onSuccess: (value) => {
          finish();
          handlers.onSuccess?.(value);
        },
        onFailure: (error) => {
          finish();
          handlers.onFailure?.(error);
        },
        onDefect: (error) => {
          finish();
          handlers.onDefect?.(error);
        },
        onInterrupt: () => {
          finish();
          handlers.onInterrupt?.();
        },
      });
      if (!completed) cancellations.current.add(cancel);
      return () => {
        cancellations.current.delete(cancel);
        cancel();
      };
    },
    [],
  );
};
