import { promises as fs } from 'node:fs';
import path from 'node:path';
import { widgetMetadataSchema } from '@scarline/contracts';

export async function loadWidgetCatalogue(widgetsDir: string): Promise<Record<string, unknown>[]> {
  const entries = await fs.readdir(widgetsDir, { withFileTypes: true });
  const results: Record<string, unknown>[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metadataPath = path.join(widgetsDir, entry.name, 'widget.json');
    try {
      const raw = await fs.readFile(metadataPath, 'utf8');
      const metadata = widgetMetadataSchema.parse(JSON.parse(raw));
      results.push({
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        category: metadata.category,
        previewUrl: `/overlay/assets/${metadata.id}/preview.png`
      });
    } catch {
      continue;
    }
  }

  return results.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}
