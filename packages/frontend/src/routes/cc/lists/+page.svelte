<script lang="ts">
  import { onMount } from 'svelte';
  import '../../../resonant.css';
  import CcPageHeader from '$lib/components/CcPageHeader.svelte';
  import ResCheckbox from '$lib/components/ResCheckbox.svelte';
  import ResEmpty from '$lib/components/ResEmpty.svelte';
  import ResSkeleton from '$lib/components/ResSkeleton.svelte';
  import { CC_API } from '$lib/utils/cc';

  let lists = $state<any[]>([]);
  let selectedList = $state<any>(null);
  let loading = $state(true);
  let showAddList = $state(false);
  let newListName = $state('');
  let newItemText = $state('');

  async function loadLists() {
    loading = true;
    try {
      const res = await fetch(`${CC_API}/lists`);
      const data = await res.json();
      lists = data.lists || [];
    } catch { /* handled by empty state */ }
    loading = false;
  }

  async function selectList(id: string) {
    const res = await fetch(`${CC_API}/lists/${id}`);
    const data = await res.json();
    selectedList = data.list;
  }

  async function createList() {
    if (!newListName.trim()) return;
    await fetch(`${CC_API}/lists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newListName.trim() }) });
    newListName = ''; showAddList = false; await loadLists();
  }

  async function addItem() {
    if (!newItemText.trim() || !selectedList) return;
    await fetch(`${CC_API}/lists/${selectedList.id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: newItemText.trim() }) });
    newItemText = ''; await selectList(selectedList.id);
  }

  async function toggleItem(itemId: string, currentChecked: number) {
    await fetch(`${CC_API}/lists/items/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checked: !currentChecked }) });
    await selectList(selectedList.id);
  }

  async function deleteItem(itemId: string) {
    await fetch(`${CC_API}/lists/items/${itemId}`, { method: 'DELETE' });
    await selectList(selectedList.id);
  }

  async function deleteList(listId: string) {
    if (!confirm('Delete this list and all its items?')) return;
    await fetch(`${CC_API}/lists/${listId}`, { method: 'DELETE' });
    await loadLists();
  }

  async function clearChecked() {
    if (!selectedList) return;
    await fetch(`${CC_API}/lists/${selectedList.id}/items`, { method: 'DELETE' });
    await selectList(selectedList.id);
  }

  onMount(loadLists);
</script>

<main class="res-page">
  <CcPageHeader title="Lists" />

  <div class="res-content">
    {#if loading}
      <ResSkeleton variant="cards" rows={4} />
    {:else if selectedList}
      <div class="res-row res-row--between">
        <button class="res-btn res-btn--ghost" onclick={() => selectedList = null}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          All lists
        </button>
        <div class="res-row" style="gap: var(--space-2);">
          <button class="res-btn res-btn--ghost" onclick={clearChecked}>Clear done</button>
          {#if selectedList.name !== 'Shopping'}
            <button class="res-btn res-btn--danger" style="padding: 0 var(--space-3);" onclick={() => { deleteList(selectedList.id); selectedList = null; }}>Delete list</button>
          {/if}
        </div>
      </div>

      <div class="res-card">
        <h2 class="list-title">{selectedList.icon || ''} {selectedList.name}</h2>

        <form class="add-item-row" onsubmit={(e) => { e.preventDefault(); addItem(); }}>
          <input type="text" bind:value={newItemText} placeholder="Add item..." class="res-input" />
          <button type="submit" class="res-btn res-btn--icon" aria-label="Add item">+</button>
        </form>

        {#if !selectedList.items?.length}
          <ResEmpty message="This list is empty" actionLabel="Add an item" onaction={() => document.querySelector<HTMLInputElement>('.add-item-row input')?.focus()} />
        {:else}
          <div class="item-list">
            {#each (selectedList.items || []).filter((i: any) => !i.checked) as item}
              <div class="item-row">
                <ResCheckbox checked={false} label={item.text} onchange={() => toggleItem(item.id, item.checked)} />
                <button class="item-del" onclick={() => deleteItem(item.id)} aria-label="Delete item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            {/each}
            {#each (selectedList.items || []).filter((i: any) => i.checked) as item}
              <div class="item-row">
                <ResCheckbox checked={true} label={item.text} onchange={() => toggleItem(item.id, item.checked)} />
                <button class="item-del" onclick={() => deleteItem(item.id)} aria-label="Delete item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="res-section-header">
        <span class="res-section-title" style="margin: 0;">Your lists</span>
        <button class="res-btn res-btn--icon" onclick={() => showAddList = !showAddList} aria-label="Create list">+</button>
      </div>

      {#if showAddList}
        <form class="res-form" onsubmit={(e) => { e.preventDefault(); createList(); }}>
          <div class="res-form-row">
            <input type="text" bind:value={newListName} placeholder="List name" class="res-input" />
            <button type="submit" class="res-btn res-btn--primary">Create</button>
          </div>
        </form>
      {/if}

      {#if lists.length === 0}
        <ResEmpty message="No lists yet" actionLabel="Create a list" onaction={() => showAddList = true} />
      {:else}
        <div class="list-grid">
          {#each lists as list}
            <div
              class="list-card-wrap res-card res-card--interactive"
              role="button"
              tabindex="0"
              onclick={() => selectList(list.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectList(list.id); } }}
            >
              <div class="list-card-content">
                <span class="list-name">{list.name}</span>
                <span class="list-count">{list.unchecked_count} of {list.item_count} items</span>
              </div>
              <button class="delete-list-btn" onclick={(e) => { e.stopPropagation(); deleteList(list.id); }} aria-label="Delete list">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</main>

<style>
  .list-title { font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--space-4); }

  .add-item-row { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }

  .item-list { display: flex; flex-direction: column; }

  .list-card-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }

  .list-card-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .list-name { font-size: var(--text-base); font-weight: 600; }
  .list-count { font-size: var(--text-xs); color: var(--text-muted); }

  .delete-list-btn {
    width: 44px; height: 44px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; transition: color var(--transition); flex-shrink: 0;
  }
  .delete-list-btn:hover { color: var(--color-danger); background: var(--bg-hover); }

  .list-grid { display: flex; flex-direction: column; gap: var(--space-3); }

  .item-row { display: flex; align-items: center; }
  .item-row :global(.checkbox) { flex: 1; }
  .item-del {
    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    transition: color var(--transition); flex-shrink: 0; opacity: 0.5;
  }
  .item-del:hover { color: var(--color-danger); opacity: 1; }
</style>
