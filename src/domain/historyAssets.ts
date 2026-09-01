import type { JSONContent } from '@tiptap/core';
import type { DeepWriteDocument } from './document';

export const HISTORY_ASSET_PREFIX = 'deepwrite-history-asset:';
export interface HistoryAsset { key: string; dataUri: string }

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function externalizeNode(node: JSONContent, assets: HistoryAsset[]): Promise<JSONContent> {
  const next: JSONContent = { ...node };
  if (node.attrs) next.attrs = { ...node.attrs };
  if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src.startsWith('data:image/')) {
    const key = await sha256(node.attrs.src);
    assets.push({ key, dataUri: node.attrs.src });
    next.attrs = { ...next.attrs, src: `${HISTORY_ASSET_PREFIX}${key}` };
  }
  if (node.content) next.content = await Promise.all(node.content.map((child) => externalizeNode(child, assets)));
  return next;
}

function hydrateNode(node: JSONContent, assets: ReadonlyMap<string, string>): JSONContent {
  const next: JSONContent = { ...node };
  if (node.attrs) next.attrs = { ...node.attrs };
  const src = node.attrs?.src;
  if (node.type === 'image' && typeof src === 'string' && src.startsWith(HISTORY_ASSET_PREFIX)) {
    const key = src.slice(HISTORY_ASSET_PREFIX.length);
    const dataUri = assets.get(key);
    if (dataUri) next.attrs = { ...next.attrs, src: dataUri };
  }
  if (node.content) next.content = node.content.map((child) => hydrateNode(child, assets));
  return next;
}

export async function externalizeHistorySnapshot(snapshot: DeepWriteDocument): Promise<{ snapshot: DeepWriteDocument; assets: HistoryAsset[] }> {
  const assets: HistoryAsset[] = [];
  const content = await externalizeNode(snapshot.content, assets);
  const unique = new Map(assets.map((asset) => [asset.key, asset]));
  return { snapshot: { ...structuredClone(snapshot), content }, assets: [...unique.values()] };
}

export function hydrateHistorySnapshot(snapshot: DeepWriteDocument, assets: ReadonlyMap<string, string>): DeepWriteDocument {
  return { ...structuredClone(snapshot), content: hydrateNode(snapshot.content, assets) };
}
