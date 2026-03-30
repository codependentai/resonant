<script lang="ts">
  import type { PresenceStatus } from '@resonant/shared';

  let { status } = $props<{ status: PresenceStatus }>();

  const statusInfo = $derived(() => {
    switch (status) {
      case 'active':
        return { color: 'var(--status-active)', text: 'Active', pulse: true };
      case 'waking':
        return { color: 'var(--status-waking)', text: 'Waking', pulse: true };
      case 'dormant':
        return { color: 'var(--status-dormant)', text: 'Dormant', pulse: false };
      case 'offline':
        return { color: 'var(--status-offline)', text: 'Offline', pulse: false };
      default:
        return { color: 'var(--status-offline)', text: 'Unknown', pulse: false };
    }
  });
</script>

<div class="presence-indicator" title={statusInfo().text}>
  <div
    class="presence-dot"
    class:pulse={statusInfo().pulse}
    style:background-color={statusInfo().color}
  ></div>
</div>

<style>
  .presence-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .presence-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    transition: background-color var(--transition);
  }

  .presence-dot.pulse {
    animation: glow 3s infinite ease-in-out;
  }

  @keyframes glow {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 4px var(--gold-ember);
    }
    50% {
      opacity: 0.7;
      box-shadow: 0 0 8px var(--gold-glow);
    }
  }
</style>
