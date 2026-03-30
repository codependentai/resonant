<script lang="ts">
  import { getConfig, updateSetting } from '$lib/stores/settings.svelte';

  const MODELS = [
    { id: 'claude-opus-4-6', label: 'Opus' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet' },
    { id: 'claude-haiku-4-5', label: 'Haiku' },
  ] as const;

  let config = $derived(getConfig());
  let currentModel = $derived(config['agent.model'] || 'claude-opus-4-6');
  let currentLabel = $derived(MODELS.find(m => m.id === currentModel)?.label || 'Opus');

  let open = $state(false);

  function toggle() {
    open = !open;
  }

  async function selectModel(modelId: string) {
    open = false;
    if (modelId === currentModel) return;
    await updateSetting('agent.model', modelId);
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.model-selector')) {
      open = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="model-selector">
  <button class="model-pill" onclick={toggle} aria-label="Select model">
    {currentLabel}
  </button>

  {#if open}
    <div class="model-dropdown">
      {#each MODELS as model}
        <button
          class="model-option"
          class:active={model.id === currentModel}
          onclick={() => selectModel(model.id)}
        >
          {model.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .model-selector {
    position: relative;
  }

  .model-pill {
    font-family: var(--font-heading);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 1rem;
    padding: 0.2rem 0.625rem;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }

  .model-pill:hover {
    color: var(--text-secondary);
    border-color: var(--border-hover);
  }

  .model-dropdown {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.25rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 6rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: dropIn 0.15s ease-out;
  }

  @keyframes dropIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-0.25rem); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .model-option {
    font-family: var(--font-heading);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all var(--transition);
    white-space: nowrap;
  }

  .model-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .model-option.active {
    color: var(--accent);
    background: var(--bg-active);
  }
</style>
