import type { RequestHandler } from './$types';
import { readWidgetAsset, widgetAssetResponse } from '$lib/server/widget-assets';

export const GET: RequestHandler = async () =>
  widgetAssetResponse(await readWidgetAsset('widget-runtime.js'), true);
