import { fail, redirect } from '@sveltejs/kit';
import { appPath } from '$lib/paths';

export const load = () => { throw redirect(303, appPath('/login')); };
export const actions = { default: () => fail(410, { message: 'Initial account setup is owned by the SCARline CLI.' }) };
