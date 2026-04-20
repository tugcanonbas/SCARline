<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
</script>

<PageHeader eyebrow="Team" title="Create Researcher" description="Add a researcher profile for study ownership and assignment." />

<div class="page-shell--wide">
  <SurfaceCard title="Profile">
    <form class="form-stack" method="POST">
      <label class="form-field">
        <span>Name</span>
        <input name="name" required />
      </label>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Email</span>
          <input name="email" type="email" />
        </label>
        <label class="form-field">
          <span>Phone</span>
          <input name="phone" />
        </label>
      </div>
      <div class="form-grid-2">
        <label class="form-field">
          <span>Institution</span>
          <input name="institution" />
        </label>
        <label class="form-field">
          <span>Role</span>
          <input name="role" />
        </label>
      </div>
      <label class="form-field">
        <span>Notes</span>
        <textarea class="min-h-32" name="notes"></textarea>
      </label>
      <div class="form-actions">
        <button class="button-primary" type="submit">Create Researcher</button>
      </div>
    </form>
  </SurfaceCard>
</div>
