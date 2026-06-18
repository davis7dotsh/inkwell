import type { Block, Span } from "@inkwell/content";
import { Image } from "expo-image";
import React, { memo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { operationalErrorMessage } from "../effect/errors";
import { useMobileEffectRunner } from "../effect/react";
import { openBrowser } from "../lib/nativeCommands";
import { makeThemedStyles, mono, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

function SpanText({ spans }: { spans: Span[] }) {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  const run = useMobileEffectRunner();
  return (
    <>
      {spans.map((span, i) => {
        const href = span.href;
        const isLink = !!href;
        return (
          <Text
            key={i}
            style={[
              span.bold && styles.bold,
              span.italic && styles.italic,
              span.code && styles.inlineCode,
              isLink && styles.link,
            ]}
            onPress={
              isLink
                ? () =>
                    run(openBrowser(href), {
                      onFailure: (error) =>
                        showError(
                          `Couldn't open link: ${operationalErrorMessage(error)}`,
                        ),
                    })
                : undefined
            }
          >
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

function ArticleImage({
  src,
  caption,
  width,
  height,
  columnWidth,
}: {
  src: string;
  caption?: string;
  width?: number;
  height?: number;
  columnWidth: number;
}) {
  // Width AND height are computed explicitly from the column width: mixing
  // an oversized natural width with maxWidth + aspectRatio leaves Yoga's
  // height at the unclamped value, reserving a huge blank box under wide
  // hero images. Images narrower than the column render at natural size.
  const { scheme } = useTheme();
  const styles = themed[scheme];
  const [aspect, setAspect] = useState(
    width && height ? width / height : 16 / 9,
  );
  const [naturalWidth, setNaturalWidth] = useState<number | undefined>(width);
  const renderWidth = Math.min(naturalWidth ?? columnWidth, columnWidth);
  const renderHeight = Math.round(renderWidth / aspect);
  return (
    <View style={styles.figure}>
      <Image
        source={{ uri: src }}
        style={{
          width: renderWidth,
          height: renderHeight,
          borderRadius: 8,
          alignSelf: "center",
        }}
        contentFit="contain"
        transition={150}
        onLoad={(e) => {
          const loaded = e.source;
          if (loaded.width > 0 && loaded.height > 0) {
            setAspect(loaded.width / loaded.height);
            if (naturalWidth === undefined) setNaturalWidth(loaded.width);
          }
        }}
      />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

function BlockView({
  block,
  contentWidth,
}: {
  block: Block;
  contentWidth: number;
}) {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  switch (block.type) {
    case "heading":
      return (
        <Text style={[styles.heading, headingStyles[block.level - 1]]}>
          <SpanText spans={block.spans} />
        </Text>
      );
    case "paragraph":
      return (
        <Text style={styles.paragraph}>
          <SpanText spans={block.spans} />
        </Text>
      );
    case "quote":
      return (
        <View style={styles.quote}>
          <Text style={[styles.paragraph, styles.quoteText]}>
            <SpanText spans={block.spans} />
          </Text>
        </View>
      );
    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text style={[styles.paragraph, styles.listItemText]}>
                <SpanText spans={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "image":
      return (
        <ArticleImage
          src={block.src}
          caption={block.caption}
          width={block.width}
          height={block.height}
          columnWidth={contentWidth}
        />
      );
    case "code":
      return (
        <View style={styles.codeBlock}>
          <Text style={styles.codeText}>{block.text}</Text>
        </View>
      );
    case "rule":
      return (
        <View style={styles.rule}>
          <View style={styles.ruleLine} />
        </View>
      );
  }
}

type Props = {
  blocks: Block[];
  /** Rendered width of the content column (px) — images size against it. */
  contentWidth: number;
  /** Reports each top-level block's layout relative to the content container. */
  onBlockLayout?: (
    index: number,
    layout: { y: number; height: number },
  ) => void;
};

/**
 * Renders article blocks. Must be a direct child of the content container so
 * that onLayout coordinates land in content space.
 */
export const BlockRenderer = memo(function BlockRenderer({
  blocks,
  contentWidth,
  onBlockLayout,
}: Props) {
  return (
    <>
      {blocks.map((block, index) => (
        <View
          key={index}
          onLayout={(e) =>
            onBlockLayout?.(index, {
              y: e.nativeEvent.layout.y,
              height: e.nativeEvent.layout.height,
            })
          }
        >
          <BlockView block={block} contentWidth={contentWidth} />
        </View>
      ))}
    </>
  );
});

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    paragraph: {
      fontFamily: serif,
      fontSize: 18,
      lineHeight: 30.5,
      color: c.ink,
      marginBottom: 20,
    },
    heading: {
      color: c.ink,
      marginTop: 14,
      marginBottom: 12,
    },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    inlineCode: {
      fontFamily: mono,
      fontSize: 15,
      backgroundColor: c.codeBackground,
    },
    link: {
      color: c.link,
      textDecorationLine: "underline",
      textDecorationColor: c.linkUnderline,
    },
    quote: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      borderRadius: 12,
      borderCurve: "continuous",
      backgroundColor: c.surfaceMuted,
      paddingHorizontal: 18,
      paddingVertical: 15,
      marginBottom: 20,
    },
    quoteText: {
      fontStyle: "italic",
      color: c.inkSecondary,
      marginBottom: 0,
    },
    list: { marginBottom: 18 },
    listItem: { flexDirection: "row", marginBottom: 8 },
    bullet: {
      fontFamily: serif,
      fontSize: 18,
      lineHeight: 30,
      color: c.accent,
      width: 26,
    },
    listItemText: { flex: 1, marginBottom: 0 },
    figure: { marginBottom: 18 },
    caption: {
      fontFamily: serif,
      fontStyle: "italic",
      fontSize: 14,
      lineHeight: 20,
      color: c.inkFaint,
      marginTop: 8,
      textAlign: "center",
    },
    codeBlock: {
      backgroundColor: c.codeBackground,
      borderRadius: 10,
      borderCurve: "continuous",
      padding: 16,
      marginBottom: 20,
    },
    codeText: {
      fontFamily: mono,
      fontSize: 13.5,
      lineHeight: 20,
      color: c.ink,
    },
    rule: {
      marginVertical: 24,
      alignItems: "center",
    },
    ruleLine: {
      width: 64,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.hairline,
    },
  }),
);

const styles_h = StyleSheet.create({
  h1: { fontFamily: serif, fontSize: 30, lineHeight: 38, fontWeight: "700" },
  h2: { fontFamily: serif, fontSize: 24, lineHeight: 32, fontWeight: "700" },
  h3: { fontFamily: serif, fontSize: 20, lineHeight: 28, fontWeight: "700" },
  h4: { fontFamily: serif, fontSize: 18, lineHeight: 26, fontWeight: "700" },
});

const headingStyles = [
  styles_h.h1,
  styles_h.h2,
  styles_h.h3,
  styles_h.h4,
  styles_h.h4,
  styles_h.h4,
];
