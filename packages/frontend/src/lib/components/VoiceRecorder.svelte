<script lang="ts">
  import { send, getTranscriptionStatus, getTranscriptionText, getTranscriptionError, getTranscriptionProsody, clearTranscription } from '$lib/stores/websocket.svelte';

  let {
    ontranscript,
  } = $props<{
    ontranscript?: (text: string, prosody?: Record<string, number> | null) => void;
  }>();

  let recording = $state(false);
  let duration = $state(0);
  let durationInterval: ReturnType<typeof setInterval> | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let localError = $state<string | null>(null);

  let transcriptionStatus = $derived(getTranscriptionStatus());
  let transcriptionText = $derived(getTranscriptionText());
  let transcriptionError = $derived(getTranscriptionError());

  let processing = $derived(transcriptionStatus === 'processing');

  // Format duration as M:SS
  function formatDuration(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    localError = null;
    clearTranscription();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Determine best mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'; // Safari fallback

      mediaRecorder = new MediaRecorder(stream, { mimeType });

      // Signal backend to start collecting chunks
      send({ type: 'voice_start' });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            if (base64) {
              send({ type: 'voice_audio', data: base64 });
            }
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        send({ type: 'voice_stop' });
      };

      mediaRecorder.start(250);
      recording = true;
      duration = 0;
      durationInterval = setInterval(() => { duration++; }, 1000);

    } catch (err) {
      console.error('Failed to start recording:', err);
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        localError = 'Microphone access denied';
      } else {
        localError = 'Failed to access microphone';
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recording = false;
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
  }

  let currentProsody = $derived(getTranscriptionProsody());

  // Watch for completed transcription and fire callback
  $effect(() => {
    if (transcriptionStatus === 'complete' && transcriptionText) {
      ontranscript?.(transcriptionText, currentProsody);
      clearTranscription();
    }
  });
</script>

<div class="voice-recorder">
  {#if localError || transcriptionError}
    <span class="voice-error">{localError || transcriptionError}</span>
  {/if}

  <button
    class="mic-button"
    class:recording
    class:processing
    onclick={toggleRecording}
    disabled={processing}
    aria-label={recording ? 'Stop recording' : processing ? 'Processing...' : 'Start recording'}
    title={recording ? 'Stop recording' : processing ? 'Processing...' : 'Voice input'}
  >
    {#if processing}
      <span class="mic-spinner"></span>
    {:else if recording}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>
    {:else}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    {/if}
  </button>

  {#if recording}
    <span class="recording-duration">{formatDuration(duration)}</span>
  {/if}
</div>

<style>
  .voice-recorder {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mic-button {
    padding: 0.75rem;
    color: var(--text-muted);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color var(--transition), background var(--transition);
  }

  .mic-button:hover:not(:disabled) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .mic-button.recording {
    color: #ef4444;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .mic-button.processing {
    opacity: 0.7;
    cursor: wait;
  }

  .mic-button:disabled {
    cursor: not-allowed;
  }

  .recording-duration {
    font-size: 0.8125rem;
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary);
    min-width: 2.5rem;
  }

  .voice-error {
    font-size: 0.75rem;
    color: var(--error, #ef4444);
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mic-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--text-muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .mic-button {
      padding: 0.5rem;
    }

    .recording-duration {
      font-size: 0.6875rem;
      min-width: 2rem;
    }

    .voice-error {
      display: none;
    }
  }
</style>
