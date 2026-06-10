// Persistence built on expo-sqlite's key-value store.
// Layout:
//   index                -> ArticleSummary[] (newest first)
//   article:<id>         -> Article
//   annotations:<id>     -> Annotations
import Storage from "expo-sqlite/kv-store";

import type { Annotations, Article, ArticleSummary } from "./types";

const INDEX_KEY = "index";
const articleKey = (id: string) => `article:${id}`;
const annotationsKey = (id: string) => `annotations:${id}`;

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await Storage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listArticles(): Promise<ArticleSummary[]> {
  return (await readJson<ArticleSummary[]>(INDEX_KEY)) ?? [];
}

export async function getArticle(id: string): Promise<Article | null> {
  return readJson<Article>(articleKey(id));
}

export async function saveArticle(article: Article): Promise<void> {
  const summary: ArticleSummary = {
    id: article.id,
    url: article.url,
    title: article.title,
    siteName: article.siteName,
    excerpt: article.excerpt,
    savedAt: article.savedAt,
  };
  const index = await listArticles();
  const next = [summary, ...index.filter((a) => a.id !== article.id)];
  await Storage.setItem(articleKey(article.id), JSON.stringify(article));
  await Storage.setItem(INDEX_KEY, JSON.stringify(next));
}

export async function deleteArticle(id: string): Promise<void> {
  const index = await listArticles();
  await Storage.setItem(
    INDEX_KEY,
    JSON.stringify(index.filter((a) => a.id !== id))
  );
  await Storage.removeItem(articleKey(id));
  await Storage.removeItem(annotationsKey(id));
}

export async function getAnnotations(id: string): Promise<Annotations | null> {
  return readJson<Annotations>(annotationsKey(id));
}

export async function saveAnnotations(annotations: Annotations): Promise<void> {
  await Storage.setItem(
    annotationsKey(annotations.articleId),
    JSON.stringify(annotations)
  );
}

export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}
