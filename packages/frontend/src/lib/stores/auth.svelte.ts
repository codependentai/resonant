let authenticated = $state(false);
let checking = $state(true);
let authRequired = $state(true);

// Backoff state for retry when server is unreachable
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_RETRIES = RETRY_DELAYS.length;

// Dedupe concurrent callers (e.g. layout + login page on first mount)
let inFlight: Promise<boolean> | null = null;

function getRetryDelay(): number {
  return RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
}

function clearRetry(): void {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

async function checkAuthInternal(isRetry: boolean): Promise<boolean> {
  // Only the user-initiated call flips the spinner — background retries
  // must not re-flash the layout loading screen.
  if (!isRetry) checking = true;

  try {
    const response = await fetch('/api/auth/check', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      authenticated = data.authenticated === true;
      if (data.auth_required === false) authRequired = false;
    } else {
      authenticated = false;
    }
    // Server responded — reset retry state regardless of status
    retryAttempt = 0;
    clearRetry();
    return authenticated;
  } catch (err) {
    // Network error (server unreachable) — schedule retry with backoff
    authenticated = false;
    retryAttempt++;
    clearRetry();
    if (retryAttempt >= MAX_RETRIES) {
      // Give up — let the UI render the login page instead of looping forever
      return false;
    }
    const delay = getRetryDelay();
    retryTimeout = setTimeout(() => {
      checkAuthInternal(true);
    }, delay);
    return false;
  } finally {
    if (!isRetry) checking = false;
  }
}

export async function checkAuth(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = checkAuthInternal(false);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password })
    });

    if (response.ok) {
      authenticated = true;
      retryAttempt = 0;
      clearRetry();
      return { success: true };
    } else {
      const data = await response.json();
      return { success: false, error: data.error || 'Login failed' };
    }
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, error: 'Network error' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    authenticated = false;
  }
}

export function stopAuthPolling(): void {
  clearRetry();
  retryAttempt = 0;
  inFlight = null;
}

export function isAuthenticated() {
  return authenticated;
}

export function isChecking() {
  return checking;
}

export function isAuthRequired() {
  return authRequired;
}
