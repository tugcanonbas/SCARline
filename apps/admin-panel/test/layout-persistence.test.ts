import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { persistAdminLayout } from '../src/lib/server/layouts';

test('passes committed instance IDs and revisions back to Participant View after its first save', async () => {
  const studyId = randomUUID();
  const conditionId = randomUUID();
  const databaseWidgetId = randomUUID();
  const layoutId = randomUUID();
  const instanceId = randomUUID();
  const clientId = randomUUID();
  let saved = false;
  const fetcher: typeof fetch = async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    let data: unknown;
    if (pathname.endsWith('/conditions')) data = [{ id: conditionId }];
    else if (pathname.endsWith('/widgets/catalogue')) data = [{ id: 'time', databaseId: databaseWidgetId }];
    else if (pathname.endsWith('/layouts')) data = [];
    else if (pathname.endsWith('/layouts/participant')) {
      assert.equal(options?.method, 'PUT');
      const body = JSON.parse(String(options?.body));
      assert.equal(body.widgets[0].widgetId, databaseWidgetId);
      assert.deepEqual(body.expectedRevisions, [{ conditionId, layoutId: null, revision: 0 }]);
      data = {
        primaryLayoutId: layoutId,
        widgets: [{ id: instanceId, order: 0 }],
        layouts: [{ conditionId, layoutId, revision: 1 }],
      };
      saved = true;
    } else throw new Error(`Unexpected request: ${pathname}`);
    return Response.json({ data });
  };
  const result = await persistAdminLayout(fetcher, {
    apiBase: 'http://core.test/api/v1', accessToken: 'test-token',
  } as App.Locals, studyId, {
    name: 'Participant', expectedRevisions: [], widgets: [{ id: clientId, widgetId: 'time' }],
  });
  assert.equal(saved, true);
  assert.equal(result.id, layoutId);
  assert.deepEqual(result.widgets, [{ id: instanceId, order: 0 }]);
  assert.deepEqual(result.expectedRevisions, [{ conditionId, layoutId, revision: 1 }]);
  assert.notEqual(instanceId, clientId);
});
