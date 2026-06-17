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
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { DecodeError } from "./errors";

export const FatalReportSchema = Schema.Struct({
  message: Schema.String,
  stack: Schema.NullOr(Schema.String),
  occurredAt: Schema.String,
  uiWasMounted: Schema.Boolean,
});

export const ArticleIdResponseSchema = Schema.Struct({
  articleId: Schema.String,
});

export const ClerkEnvironmentResponseSchema = Schema.Struct({
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        code: Schema.optional(Schema.String),
      })
    )
  ),
});

const MobileConfigSchema = Schema.Struct({
  clerkPublishableKey: Schema.optional(Schema.String),
  convexUrl: Schema.optional(Schema.String),
  apiUrl: Schema.optional(Schema.String),
});

const configResult = Schema.decodeUnknownResult(MobileConfigSchema)({
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
});

export const mobileConfig = Result.isSuccess(configResult)
  ? configResult.success
  : {
      clerkPublishableKey: undefined,
      convexUrl: undefined,
      apiUrl: undefined,
    };

const decodeJson = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  source: string,
  json: string
) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(json).pipe(
    Effect.mapError(
      (error) =>
        new DecodeError({
          source,
          message: String(error),
        })
    )
  );

const decodeTolerantArrayJson = <A>(
  schema: Schema.Decoder<A, never>,
  source: string,
  json: string
): Effect.Effect<A[], DecodeError> => {
  const decoded = decodeTolerantJsonArray(json, schema);
  return Option.isSome(decoded)
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new DecodeError({
          source,
          message: "Expected a valid JSON array",
        })
      );
};

export const decodeArticleBlocks = (
  json: string
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
                item.map((span) => ({ ...span }))
              ),
            };
          case "image":
          case "code":
          case "rule":
            return { ...block };
        }
      })
    )
  );

export const decodeAnnotations = (input: {
  contentWidth: number;
  strokesJson: string;
  boxesJson: string;
  notesJson: string;
  memosJson?: string;
}): Effect.Effect<Annotations, DecodeError> =>
  Effect.all({
    contentWidth: Schema.decodeUnknownEffect(ContentWidthSchema)(
      input.contentWidth
    ).pipe(
      Effect.mapError(
        (error) =>
          new DecodeError({
            source: "annotation content width",
            message: String(error),
          })
      )
    ),
    strokes: decodeTolerantArrayJson(
      StrokeSchema,
      "annotation strokes",
      input.strokesJson
    ),
    boxes: decodeTolerantArrayJson(
      BoxAnnotationSchema,
      "annotation boxes",
      input.boxesJson
    ),
    notes: decodeTolerantArrayJson(
      NoteAnnotationSchema,
      "annotation notes",
      input.notesJson
    ),
    memos: decodeTolerantArrayJson(
      VoiceMemoAnnotationSchema,
      "annotation voice memos",
      input.memosJson ?? "[]"
    ),
  }).pipe(
    Effect.map(
      ({ contentWidth, strokes, boxes, notes, memos }): Annotations => ({
        contentWidth,
        strokes: strokes.map(
          (stroke): Stroke => ({
            ...stroke,
            points: stroke.points.map((point) => ({ ...point })),
          })
        ),
        boxes: boxes.map(
          (box): BoxAnnotation => ({
            ...box,
          })
        ),
        notes: notes.map(
          (note): NoteAnnotation => ({
            ...note,
          })
        ),
        memos: memos.map(
          (memo): VoiceMemoAnnotation => ({
            ...memo,
          })
        ),
      })
    )
  );

export const decodeFatalReport = (json: string) =>
  decodeJson(FatalReportSchema, "fatal error report", json);

export const decodeArticleIdResponse = (value: unknown, source: string) =>
  Schema.decodeUnknownEffect(ArticleIdResponseSchema)(value).pipe(
    Effect.mapError(
      (error) =>
        new DecodeError({
          source,
          message: String(error),
        })
    )
  );

export const decodeClerkEnvironmentResponse = (value: unknown) =>
  Schema.decodeUnknownEffect(ClerkEnvironmentResponseSchema)(value).pipe(
    Effect.mapError(
      (error) =>
        new DecodeError({
          source: "Clerk environment response",
          message: String(error),
        })
    )
  );
