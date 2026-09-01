import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { externalizeHistorySnapshot, HISTORY_ASSET_PREFIX, hydrateHistorySnapshot } from './historyAssets';

describe('history image assets', () => {
  it('stores repeated embedded images once and hydrates them on read', async () => {
    const document = createDocument('含图稿');
    const dataUri = `data:image/png;base64,${'A'.repeat(512)}`;
    document.content = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: dataUri, alt: 'a' } },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
        { type: 'image', attrs: { src: dataUri, alt: 'b' } }
      ]
    };

    const externalized = await externalizeHistorySnapshot(document);
    expect(externalized.assets).toHaveLength(1);
    const stored = JSON.stringify(externalized.snapshot);
    expect(stored).not.toContain(dataUri);
    expect(stored).toContain(HISTORY_ASSET_PREFIX);

    const hydrated = hydrateHistorySnapshot(externalized.snapshot, new Map([[externalized.assets[0].key, dataUri]]));
    expect(hydrated.content.content?.[0].attrs?.src).toBe(dataUri);
    expect(hydrated.content.content?.[2].attrs?.src).toBe(dataUri);
  });
});
