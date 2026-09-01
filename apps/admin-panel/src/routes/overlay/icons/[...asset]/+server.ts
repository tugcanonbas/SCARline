import type { RequestHandler } from './$types';
import { readWidgetAsset, widgetAssetResponse, WidgetAssetNotFoundError } from '$lib/server/widget-assets';

export const GET: RequestHandler = async ({ params }) => {
  try {
    return widgetAssetResponse(await readWidgetAsset(`icons/${params.asset}`), true);
  } catch (cause) {
    if (cause instanceof WidgetAssetNotFoundError) return new Response('Icon not found', { status: 404 });
    throw cause;
  }
};
