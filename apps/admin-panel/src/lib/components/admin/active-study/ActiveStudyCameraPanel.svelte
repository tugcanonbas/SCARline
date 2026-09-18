<script lang="ts">
  import { onDestroy } from 'svelte';
  import EmptyState from '$lib/components/admin/EmptyState.svelte';
  import InlineNotice from '$lib/components/admin/InlineNotice.svelte';
  import SurfaceCard from '$lib/components/SurfaceCard.svelte';
  import { Video, VideoOff } from 'lucide-svelte';

  let element: HTMLVideoElement | null = $state(null);
  let stream: MediaStream | null = $state(null);
  let cameras: Array<{ deviceId: string; label: string }> = $state([]);
  let selected = $state('');
  let message = $state('');
  let busy = $state(false);
  const live = $derived(stream !== null);

  // Labels stay blank until the viewer has granted access once, so the list is
  // refreshed after a successful start rather than only on mount.
  async function loadCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const found = await navigator.mediaDevices.enumerateDevices();
      cameras = found
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`
        }));
      if (!cameras.some((camera) => camera.deviceId === selected)) selected = cameras[0]?.deviceId ?? '';
    } catch {
      // Enumeration is best effort; starting the feed reports the real problem.
    }
  }

  function describe(error: unknown): string {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return 'Camera permission was denied. Allow camera access for this site in your browser, then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      return 'No camera was found on this machine.';
    if (name === 'NotReadableError' || name === 'AbortError')
      return 'The camera is already in use by another application. The IO Client camera driver holds it for the whole session, so stop that device assignment to preview here.';
    return error instanceof Error ? error.message : 'The camera could not be started.';
  }

  async function start() {
    if (busy) return;
    message = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      message = 'This browser cannot open a camera here. Camera access needs a secure context — https, or localhost.';
      return;
    }
    busy = true;
    try {
      stop();
      stream = await navigator.mediaDevices.getUserMedia({
        video: selected ? { deviceId: { exact: selected } } : true,
        audio: false
      });
      await loadCameras();
    } catch (error) {
      message = describe(error);
      stream = null;
    } finally {
      busy = false;
    }
  }

  function stop() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  // Releasing the device matters: a held camera blocks every other consumer.
  onDestroy(stop);
  $effect(() => {
    if (element) element.srcObject = stream;
  });
  void loadCameras();
</script>

<SurfaceCard
  title="Camera"
  subtitle="Local preview for checking framing and lighting. It is not recorded and is not part of the session record."
>
  {#snippet actions()}
    <button
      class={live ? 'button-secondary' : 'button-primary'}
      type="button"
      onclick={live ? stop : start}
      disabled={busy}
    >
      {#if live}
        <VideoOff size={16} strokeWidth={1.5} /> Stop
      {:else}
        <Video size={16} strokeWidth={1.5} /> {busy ? 'Starting…' : 'Start camera'}
      {/if}
    </button>
  {/snippet}

  {#if message}
    <InlineNotice tone="warning" message={message} />
  {/if}

  {#if live}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={element}
      class="aspect-video w-full rounded-lg bg-black object-cover"
      autoplay
      muted
      playsinline
    ></video>
  {:else if !message}
    <EmptyState message="The camera is off. Start it to check the participant's framing." />
  {/if}

  {#if cameras.length > 1}
    <label class="form-field mt-2">
      <span class="form-field__hint">Camera</span>
      <select bind:value={selected} onchange={() => live && start()}>
        {#each cameras as camera}
          <option value={camera.deviceId}>{camera.label}</option>
        {/each}
      </select>
    </label>
  {/if}
</SurfaceCard>
