<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="error-page">
  <div class="error-content">
    <h1>{$page.status}</h1>
    <p>{$page.error?.message || 'Something went wrong'}</p>
    <div class="actions">
      <button onclick={() => window.location.reload()}>Reload</button>
      <a href="/chat">Go home</a>
    </div>
  </div>
</div>

<style>
  .error-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    padding: 2rem;
  }

  .error-content {
    text-align: center;
    max-width: 400px;
  }

  h1 {
    font-size: 4rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: var(--accent);
  }

  p {
    font-size: 1.1rem;
    color: var(--text-secondary);
    margin: 0 0 2rem;
  }

  .actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  button, a {
    padding: 0.6rem 1.4rem;
    border-radius: 6px;
    font-size: 0.9rem;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  button {
    background: var(--accent);
    color: var(--bg-primary);
    border: none;
    font-weight: 600;
  }

  a {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  button:hover, a:hover {
    opacity: 0.85;
  }
</style>
