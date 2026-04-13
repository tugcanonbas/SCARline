<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';

  let { data } = $props();
  const roles = ['admin', 'researcher', 'operator', 'viewer'];
</script>

<PageHeader
  eyebrow="Access"
  title="Users"
  description="Admin-managed accounts, role assignment, activation state, and optional researcher profile linkage."
/>

<div class="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
  <SurfaceCard title="Create Account">
    <form class="grid gap-4" method="POST" action="?/create">
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Username</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="username" required />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Display Name</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="displayName" required />
        </label>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="grid gap-2 text-sm">
          <span>Email</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="email" type="email" />
        </label>
        <label class="grid gap-2 text-sm">
          <span>Initial Password</span>
          <input class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" minlength="8" name="password" type="password" required />
        </label>
      </div>
      <label class="grid gap-2 text-sm">
        <span>Researcher Profile</span>
        <select class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3" name="researcherId">
          <option value="">No profile link</option>
          {#each data.researchers as researcher}
            <option value={researcher.id}>{researcher.name}</option>
          {/each}
        </select>
      </label>
      <div class="grid gap-2 text-sm">
        <span>Roles</span>
        <div class="grid gap-2 md:grid-cols-2">
          {#each roles as role}
            <label class="flex items-center gap-2 rounded-2xl border border-[--color-line] bg-[--color-panel-soft] px-4 py-3">
              <input name="roles" type="checkbox" value={role} checked={role === 'viewer'} />
              <span>{role}</span>
            </label>
          {/each}
        </div>
      </div>
      <button class="rounded-2xl bg-[--color-accent-strong] px-5 py-3 text-sm font-semibold text-white" type="submit">Create User</button>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Accounts">
    <div class="space-y-4">
      {#each data.users as user}
        <div class="rounded-2xl border border-[--color-line] bg-[--color-panel-soft] p-4">
          <form class="grid gap-3" method="POST" action="?/update">
            <input name="userId" type="hidden" value={user.id} />
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Display Name</span>
                <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm text-white" name="displayName" value={user.displayName ?? user.display_name ?? ''} />
              </label>
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Email</span>
                <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm text-white" name="email" type="email" value={user.email ?? ''} />
              </label>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-2 text-xs text-slate-400">
                <span>Researcher Profile</span>
                <select class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm text-white" name="researcherId">
                  <option value="">No profile link</option>
                  {#each data.researchers as researcher}
                    <option value={researcher.id} selected={(user.researcherId ?? user.researcher_id) === researcher.id}>{researcher.name}</option>
                  {/each}
                </select>
              </label>
              <label class="grid gap-2 text-xs text-slate-400">
                <span>New Password</span>
                <input class="rounded-2xl border border-[--color-line] bg-black/20 px-4 py-3 text-sm text-white" minlength="8" name="password" placeholder="Leave unchanged" type="password" />
              </label>
            </div>
            <div class="grid gap-2 text-xs text-slate-400 md:grid-cols-4">
              {#each roles as role}
                <label class="flex items-center gap-2 rounded-2xl border border-[--color-line] bg-black/20 px-3 py-2">
                  <input name="roles" type="checkbox" value={role} checked={(user.roles ?? []).includes(role)} />
                  <span>{role}</span>
                </label>
              {/each}
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input name="isActive" type="checkbox" checked={user.isActive ?? user.is_active} />
                <span>Active account for {user.username}</span>
              </label>
              <button class="rounded-full border border-[--color-line] px-3 py-1 text-xs text-slate-200" type="submit">Save</button>
            </div>
          </form>
          <form class="mt-2" method="POST" action="?/deactivate">
            <input name="userId" type="hidden" value={user.id} />
            <button class="rounded-full border border-[--color-danger]/40 px-3 py-1 text-xs text-red-200" type="submit">Deactivate</button>
          </form>
        </div>
      {:else}
        <p class="rounded-2xl border border-dashed border-[--color-line] px-4 py-6 text-sm text-slate-400">No users have been created.</p>
      {/each}
    </div>
  </SurfaceCard>
</div>
