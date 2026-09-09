import { json } from '@sveltejs/kit';

export const GET = () => json({ status: 'ok', component: 'admin-panel' });
