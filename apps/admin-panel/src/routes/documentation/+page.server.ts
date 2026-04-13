import { requireRole } from '$lib/server/rbac';

export const load = async ({ fetch, locals }) => {
  await requireRole(fetch, locals.apiBase, locals.accessToken, ['admin', 'researcher', 'operator', 'viewer']);
  return {
    docsBase: '/docs/',
    sections: [
      { title: 'Product Requirements', href: '/docs/PRD.md' },
      { title: 'Core API', href: '/docs/CORE_API.md' },
      { title: 'RabbitMQ Commands and Events', href: '/docs/RABBITMQ_EVENTS_AND_COMMANDS.md' },
      { title: 'Database Entities', href: '/docs/DATABASE_ENTITIES.md' },
      { title: 'Widget Catalogue', href: '/docs/WIDGET_CATALOGUE.md' }
    ]
  };
};
