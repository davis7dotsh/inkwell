import type {
  Annotations,
  Block,
  BoxAnnotation,
  NoteAnnotation,
  Stroke,
  VoiceMemoAnnotation,
} from "@inkwell/content";
import {
  BlocksSchema,
  BoxAnnotationSchema,
  ContentWidthSchema,
  NoteAnnotationSchema,
  StrokeSchema,
  VoiceMemoAnnotationSchema,
  decodeTolerantJsonArray,
} from "@inkwell/content/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { z } from "zod";

import { DecodeError } from "./errors";

export const FatalReportSchema = z.object({
  message: z.string(),
  stack: z.string().nullable(),
  occurredAt: z.string(),
  uiWasMounted: z.boolean(),
});

export const ArticleIdResponseSchema = z.object({
  articleId: z.string(),
});

export const ClerkEnvironmentResponseSchema = z.object({
  errors: z
    .array(
      z.object({
        code: z.string().optional(),
      }),
    )
    .optional(),
});

const MobileConfigSchema = z.object({
  clerkPublishableKey: z.string().optional(),
  convexUrl: z.string().optional(),
  apiUrl: z.string().optional(),
});

const configResult = MobileConfigSchema.safeParse({
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
});

export const mobileConfig = configResult.success
  ? configResult.data
  : {
      clerkPublishableKey: undefined,
      convexUrl: undefined,
      apiUrl: undefined,
    };

const decodeJson = <A>(schema: z.ZodType<A>, source: string, json: string) =>
  Effect.try({
    try: () => schema.parse(JSON.parse(json)),
    catch: (error) =>
      new DecodeError({
        source,
        message: String(error),
      }),
  });

const decodeTolerantArrayJson = <A>(
  schema: z.ZodType<A>,
  source: string,
  json: string,
): Effect.Effect<A[], DecodeError> => {
  const decoded = decodeTolerantJsonArray(json, schema);
  return Option.isSome(decoded)
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new DecodeError({
          source,
          message: "Expected a valid JSON array",
        }),
      );
};

export const decodeArticleBlocks = (
  json: string,
): Effect.Effect<Block[], DecodeError> =>
  decodeJson(BlocksSchema, "article blocks", json).pipe(
    Effect.map((blocks): Block[] =>
      blocks.map((block): Block => {
        switch (block.type) {
          case "heading":
            return {
              ...block,
              spans: block.spans.map((span) => ({ ...span })),
            };
          case "paragraph":
          case "quote":
            return {
              ...block,
              spans: block.spans.map((span) => ({ ...span })),
            };
          case "list":
            return {
              ...block,
              items: block.items.map((item) =>
                item.map((span) => ({ ...span })),
              ),
            };
          case "image":
          case "code":
          case "rule":
            return { ...block };
        }
      }),
    ),
  );

export const decodeAnnotations = (input: {
  contentWidth: number;
  strokesJson: string;
  boxesJson: string;
  notesJson: string;
  memosJson?: string;
}): Effect.Effect<Annotations, DecodeError> =>
  Effect.all({
    contentWidth: Effect.try({
      try: () => ContentWidthSchema.parse(input.contentWidth),
      catch: (error) =>
        new DecodeError({
          source: "annotation content width",
          message: String(error),
        }),
    }),
    strokes: decodeTolerantArrayJson(
      StrokeSchema,
      "annotation strokes",
      input.strokesJson,
    ),
    boxes: decodeTolerantArrayJson(
      BoxAnnotationSchema,
      "annotation boxes",
      input.boxesJson,
    ),
    notes: decodeTolerantArrayJson(
      NoteAnnotationSchema,
      "annotation notes",
      input.notesJson,
    ),
    memos: decodeTolerantArrayJson(
      VoiceMemoAnnotationSchema,
      "annotation voice memos",
      input.memosJson ?? "[]",
    ),
  }).pipe(
    Effect.map(
      ({ contentWidth, strokes, boxes, notes, memos }): Annotations => ({
        contentWidth,
        strokes: strokes.map(
          (stroke): Stroke => ({
            ...stroke,
            points: stroke.points.map((point) => ({ ...point })),
          }),
        ),
        boxes: boxes.map(
          (box): BoxAnnotation => ({
            ...box,
          }),
        ),
        notes: notes.map(
          (note): NoteAnnotation => ({
            ...note,
          }),
        ),
        memos: memos.map(
          (memo): VoiceMemoAnnotation => ({
            ...memo,
          }),
        ),
      }),
    ),
  );

export const decodeFatalReport = (json: string) =>
  decodeJson(FatalReportSchema, "fatal error report", json);

export const decodeArticleIdResponse = (value: unknown, source: string) =>
  Effect.try({
    try: () => ArticleIdResponseSchema.parse(value),
    catch: (error) =>
      new DecodeError({
        source,
        message: String(error),
      }),
  });

export const decodeClerkEnvironmentResponse = (value: unknown) =>
  Effect.try({
    try: () => ClerkEnvironmentResponseSchema.parse(value),
    catch: (error) =>
      new DecodeError({
        source: "Clerk environment response",
        message: String(error),
      }),
  });
