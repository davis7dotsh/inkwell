import type { Block, Span } from "@inkwell/content";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import React, { memo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, mono, serif } from "../lib/theme";

import { BrushStroke } from "./BrushStroke";

function SpanText({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const isLink = !!span.href;
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
                ? () => WebBrowser.openBrowserAsync(span.href!).catch(() => {})
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
}: {
  src: string;
  caption?: string;
  width?: number;
  height?: number;
}) {
  // Extraction-time dimensions give a stable layout up front; the loaded
  // image refines the aspect ratio. Images narrower than the column render
  // at their natural size instead of stretching to fill it.
  const [aspect, setAspect] = useState(
    width && height ? width / height : 16 / 9
  );
  const [displayWidth, setDisplayWidth] = useState<number | undefined>(width);
  return (
    <View style={styles.figure}>
      <Image
        source={{ uri: src }}
        style={{
          width: displayWidth ?? "100%",
          maxWidth: "100%",
          aspectRatio: aspect,
          borderRadius: 8,
          alignSelf: "center",
        }}
        contentFit="contain"
        transition={150}
        onLoad={(e) => {
          const loaded = e.source;
          if (loaded.width > 0 && loaded.height > 0) {
            setAspect(loaded.width / loaded.height);
            if (displayWidth === undefined) setDisplayWidth(loaded.width);
          }
        }}
      />
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

function BlockView({ block }: { block: Block }) {
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
          <BrushStroke width={150} height={7} color={colors.wash} opacity={0.6} />
        </View>
      );
  }
}

type Props = {
  blocks: Block[];
  /** Reports each top-level block's layout relative to the content container. */
  onBlockLayout?: (index: number, layout: { y: number; height: number }) => void;
};

/**
 * Renders article blocks. Must be a direct child of the content container so
 * that onLayout coordinates land in content space.
 */
export const BlockRenderer = memo(function BlockRenderer({
  blocks,
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
          <BlockView block={block} />
        </View>
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  paragraph: {
    fontFamily: serif,
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
    marginBottom: 18,
  },
  heading: {
    color: colors.ink,
    marginTop: 14,
    marginBottom: 12,
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: {
    fontFamily: mono,
    fontSize: 15,
    backgroundColor: colors.codeBackground,
  },
  link: {
    color: colors.link,
    textDecorationLine: "underline",
    textDecorationColor: colors.linkUnderline,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 16,
    marginBottom: 18,
  },
  quoteText: {
    fontStyle: "italic",
    color: colors.inkSecondary,
    marginBottom: 0,
  },
  list: { marginBottom: 18 },
  listItem: { flexDirection: "row", marginBottom: 8 },
  bullet: {
    fontFamily: serif,
    fontSize: 18,
    lineHeight: 30,
    color: colors.accent,
    width: 26,
  },
  listItemText: { flex: 1, marginBottom: 0 },
  figure: { marginBottom: 18 },
  caption: {
    fontFamily: serif,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkFaint,
    marginTop: 8,
    textAlign: "center",
  },
  codeBlock: {
    backgroundColor: colors.codeBackground,
    borderRadius: 8,
    padding: 14,
    marginBottom: 18,
  },
  codeText: {
    fontFamily: mono,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink,
  },
  rule: {
    marginVertical: 18,
    alignItems: "center",
  },
});

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
