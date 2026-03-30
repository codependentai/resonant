<script lang="ts">
  import { onMount } from 'svelte';

  interface Skill {
    name: string;
    description: string;
  }

  let skills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const response = await fetch('/api/skills');
      if (!response.ok) throw new Error('Failed to fetch skills');
      const data = await response.json();
      skills = data.skills;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load skills';
    } finally {
      loading = false;
    }
  });
</script>

<div class="skills-panel">
  {#if loading}
    <p class="loading">Loading skills...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if skills.length === 0}
    <p class="empty">No skills found in agent workspace.</p>
  {:else}
    <div class="skills-grid">
      {#each skills as skill}
        <div class="skill-card">
          <h3 class="skill-name">{skill.name}</h3>
          <p class="skill-description">{skill.description}</p>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .skills-panel {
    width: 100%;
    max-width: none;
    min-height: 0;
  }

  .loading, .error, .empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .error {
    color: var(--error, #ef4444);
  }

  .skills-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skill-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem 1.25rem;
  }

  .skill-name {
    font-family: var(--font-heading);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0;
    margin-bottom: 0.375rem;
  }

  .skill-description {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
</style>
