<script lang="ts">
  import EmptyState from "$lib/components/admin/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import SurfaceCard from "$lib/components/SurfaceCard.svelte";
  import { formatStatusLabel } from "$lib/format";

  let { data } = $props();
  const roles = ["admin", "researcher", "operator", "observer"];
</script>

<div class="section-grid section-grid--sidebar">
  <SurfaceCard title="Create Account">
    <form class="form-stack" method="POST" action="?/create">
      <div class="form-grid-2">
        <label class="form-field">
          <span>Username</span>
          <input name="username" required />
        </label>
        <label class="form-field">
          <span>Display Name</span>
          <input name="displayName" required />
        </label>
      </div>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label class="form-field">
          <span>Initial Password</span>
          <input minlength="12" name="password" type="password" required />
        </label>
      </div>
      <label class="form-field">
        <span>Researcher Profile</span>
        <select name="researcherId">
          <option value="">No profile link</option>
          {#each data.researchers as researcher}
            <option value={researcher.id}>{researcher.name}</option>
          {/each}
        </select>
      </label>
      <div class="form-field">
        <span>Roles</span>
        <div class="choice-grid">
          {#each roles as role}
            <label class="form-choice-card">
              <input
                name="roles"
                type="checkbox"
                value={role}
                checked={role === "observer"}
              />
              <span>{formatStatusLabel(role)}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="form-actions">
        <button class="button-primary" type="submit">Create User</button>
      </div>
    </form>
  </SurfaceCard>

  <SurfaceCard title="Existing Accounts">
    <div class="list-stack">
      {#each data.users as user}
        <div class="entity-card">
          <form class="form-stack" method="POST" action="?/update">
            <input name="userId" type="hidden" value={user.id} />
            <div class="form-grid-2">
              <label class="form-field form-field--compact">
                <span>Display Name</span>
                <input
                  name="displayName"
                  value={user.displayName ?? user.display_name ?? ""}
                />
              </label>
              <label class="form-field form-field--compact">
                <span>Email</span>
                <input name="email" type="email" value={user.email ?? ""} />
              </label>
            </div>
            <div class="form-grid-2">
              <label class="form-field form-field--compact">
                <span>Researcher Profile</span>
                <select name="researcherId">
                  <option value="">No profile link</option>
                  {#each data.researchers as researcher}
                    <option
                      value={researcher.id}
                      selected={(user.researcherId ?? user.researcher_id) ===
                        researcher.id}>{researcher.name}</option
                    >
                  {/each}
                </select>
              </label>
              <label class="form-field form-field--compact">
                <span>New Password</span>
                <input
                  minlength="12"
                  name="password"
                  placeholder="Leave unchanged"
                  type="password"
                />
              </label>
            </div>
            <div class="choice-grid choice-grid--4">
              {#each roles as role}
                <label class="form-choice-card">
                  <input
                    name="roles"
                    type="checkbox"
                    value={role}
                    checked={(user.roles ?? []).includes(role)}
                  />
                  <span>{formatStatusLabel(role)}</span>
                </label>
              {/each}
            </div>
            <div class="toolbar">
              <label class="form-choice-card">
                <input
                  name="isActive"
                  type="checkbox"
                  checked={user.isActive ?? user.is_active}
                />
                <span>Active account for {user.username}</span>
              </label>
              <button class="button-chip" type="submit">Save</button>
            </div>
          </form>
          <form class="mt-2" method="POST" action="?/deactivate">
            <input name="userId" type="hidden" value={user.id} />
            <button class="button-danger" type="submit">Deactivate</button>
          </form>
        </div>
      {:else}
        <EmptyState message="No users have been created." />
      {/each}
    </div>
  </SurfaceCard>
</div>
