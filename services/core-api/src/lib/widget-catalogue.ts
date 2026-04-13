import { promises as fs } from 'node:fs';
import path from 'node:path';
import { widgetMetadataSchema } from '@scarline/contracts';

export async function loadWidgetCatalogue(widgetsDir: string): Promise<Record<string, unknown>[]> {
  const candidateComponentsDir = path.join(widgetsDir, 'components');
  const baseDir = await fs.access(candidateComponentsDir).then(() => candidateComponentsDir).catch(() => widgetsDir);
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const results: Record<string, unknown>[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const widgetDir = path.join(baseDir, entry.name);
    const metadataPath = path.join(widgetDir, 'widget.json');
    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const metadata = widgetMetadataSchema.parse(JSON.parse(raw));
      const previewFile = `${metadata.id}.png`;
      const hasWidgetPreview = await fs
        .access(path.join(widgetDir, previewFile))
        .then(() => true)
        .catch(() => false);
      results.push({
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        category: metadata.category,
        previewUrl: `/overlay/assets/${metadata.id}/${hasWidgetPreview ? previewFile : 'index.html'}`
      });
    } catch {
      continue;
    }
  }

  return results.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}
