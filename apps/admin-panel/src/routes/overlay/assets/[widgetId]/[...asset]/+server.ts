import type { RequestHandler } from './$types';
import {
  readWidgetComponentAsset,
  widgetAssetResponse,
  WidgetAssetNotFoundError
} from '$lib/server/widget-assets';

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const preview = url.searchParams.get('preview') === 'admin';
    return widgetAssetResponse(
      await readWidgetComponentAsset(params.widgetId, params.asset, preview),
      true
    );
  } catch (cause) {
    if (cause instanceof WidgetAssetNotFoundError) {
      return new Response('Widget asset not found', { status: 404 });
    }
    throw cause;
  }
};
