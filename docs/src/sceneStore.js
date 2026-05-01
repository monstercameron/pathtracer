import { batch, computed, signal } from '@preact/signals';

const readItemId = (item, index) => {
  if (item && typeof item === 'object') {
    return item.entityId ?? `scene-item-${index}`;
  }
  return `scene-item-${index}`;
};

const readItemName = (item, index) => {
  if (item && typeof item === 'object') {
    return item.name ?? item.displayName ?? item.label ?? `Scene item #${index}`;
  }
  return `Scene item #${index}`;
};

export const normalizeSceneItem = (item, index = 0) => {
  const id = String(readItemId(item, index));
  if (!item || typeof item !== 'object') {
    return Object.freeze({
      id,
      index,
    name: readItemName(item, index),
    parentEntityId: null,
    isHidden: false,
    isLocked: false,
    source: item
    });
  }

  return Object.freeze({
    ...item,
    id,
    index: item.index ?? index,
    name: readItemName(item, index),
    parentEntityId: item.parentEntityId ?? null,
    isHidden: Boolean(item.isHidden),
    isLocked: Boolean(item.isLocked),
    source: item
  });
};

export const sceneItems = signal([]);
export const selectedItemId = signal(null);

export const selectedSceneItem = computed(() => {
  const selectedId = selectedItemId.value;
  if (selectedId === null || selectedId === undefined) {
    return null;
  }
  return sceneItems.value.find((item) => item.id === String(selectedId)) || null;
});

export const sceneItemCountLabel = computed(() => {
  const itemCount = sceneItems.value.length;
  return `${itemCount} scene ${itemCount === 1 ? 'item' : 'items'}`;
});

export const setSceneItems = (items) => {
  sceneItems.value = Array.isArray(items)
    ? items.map((item, index) => normalizeSceneItem(item, index))
    : [];

  if (
    selectedItemId.value !== null &&
    !sceneItems.value.some((item) => item.id === String(selectedItemId.value))
  ) {
    selectedItemId.value = null;
  }
};

export const setSelectedItemId = (itemId) => {
  selectedItemId.value = itemId === null || itemId === undefined ? null : String(itemId);
};

export const selectSceneItem = setSelectedItemId;

export const updateSceneSignals = (items, nextSelectedItemId = selectedItemId.value) => {
  batch(() => {
    setSceneItems(items);
    setSelectedItemId(nextSelectedItemId);
  });
};

export const clearSceneSelection = () => setSelectedItemId(null);
