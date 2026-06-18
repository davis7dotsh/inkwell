import type { Annotations, Block } from "@inkwell/content";
import {
  BlocksJsonSchema,
  BoxAnnotationSchema,
  ContentWidthSchema,
  NoteAnnotationSchema,
  StrokeSchema,
  VoiceMemoAnnotationSchema,
  decodeTolerantJsonArray,
} from "@inkwell/content/schema";
import { Effect, Option } from "effect";
import { z } from "zod";

import { PersistedContentError } from "./errors";

const decodePersisted = <A>(
  source: string,
  schema: z.ZodType<A>,
  input: unknown,
): Effect.Effect<A, PersistedContentError> =>
  Effect.try({
    try: () => schema.parse(input),
    catch: (error) =>
      new PersistedContentError({
        source,
        message: String(error),
      }),
  });

const decodeTolerantArray = <A>(
  source: string,
  schema: z.ZodType<A>,
  input: string,
): Effect.Effect<A[], PersistedContentError> => {
  const decoded = decodeTolerantJsonArray(input, schema);
  return Option.isSome(decoded)
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new PersistedContentError({
          source,
          message: "Expected a valid JSON array",
        }),
      );
};

export const decodeBlocksJson = (
  blocksJson: string,
): Effect.Effect<Block[], PersistedContentError> =>
  decodePersisted("article blocks", BlocksJsonSchema, blocksJson);

export const decodeAnnotationsJson = (doc: {
  contentWidth: number;
  strokesJson: string;
  boxesJson: string;
  notesJson: string;
  memosJson?: string;
}): Effect.Effect<Annotations, PersistedContentError> =>
  Effect.gen(function* () {
    const contentWidth = yield* decodePersisted(
      "annotation content width",
      ContentWidthSchema,
      doc.contentWidth,
    );
    const strokes = yield* decodeTolerantArray(
      "annotation strokes",
      StrokeSchema,
      doc.strokesJson,
    );
    const boxes = yield* decodeTolerantArray(
      "annotation boxes",
      BoxAnnotationSchema,
      doc.boxesJson,
    );
    const notes = yield* decodeTolerantArray(
      "annotation notes",
      NoteAnnotationSchema,
      doc.notesJson,
    );
    const memos = yield* decodeTolerantArray(
      "annotation memos",
      VoiceMemoAnnotationSchema,
      doc.memosJson ?? "[]",
    );
    return {
      contentWidth,
      strokes,
      boxes,
      notes,
      memos,
    };
  });
