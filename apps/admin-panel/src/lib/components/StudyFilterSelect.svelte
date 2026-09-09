<script lang="ts">
  let { studies = [], value = "" } = $props<{
    studies?: Array<{ id: string; name: string }>;
    value?: string;
  }>();
</script>

<select class="w-full" style="width: 100%;" name="studyId">
  <option value="">All studies</option>
  {#each studies as study}
    <option value={study.id} selected={value === study.id}>{study.name}</option>
  {/each}
</select>
