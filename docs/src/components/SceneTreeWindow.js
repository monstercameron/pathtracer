import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { uiLogger } from '../logger.js';
import {
  canDeleteSceneItems,
  canReparentSceneItems,
  canGroupSceneItems,
  canUngroupSceneItems,
  deleteSelectedSceneItems,
  groupSelectedSceneItems,
  readSceneItemComponentRows,
  reparentSceneItems,
  sceneItemCountLabel,
  sceneTreeRoots,
  selectedItemId,
  selectedItemIds,
  setSelectedItemIds,
  ungroupSelectedSceneItems
} from '../sceneStore.js';
import {
  SCENE_TREE_CREATE_PANEL_ID,
  isSceneTreeCreateMenuOpen,
  openUiPanel,
  setSceneTreeCreateMenuOpen,
  setUiWindowVisible,
  toggleSceneTreeCreateMenuOpen,
  uiWindowVisibilitySignals
} from '../store.js';
import { FloatingWindow } from './FloatingWindow.js';
import { PRIMITIVE_ACTIONS } from './panels/CreatePanel.js';

const PANEL_LINKS = Object.freeze([
  { label: 'Object', panelTarget: 'object-panel' },
  { label: 'Render', panelTarget: 'render-panel' },
  { label: 'Physics', panelTarget: 'physics-panel' },
  { label: 'Camera', panelTarget: 'camera-panel' },
  { label: 'Output', panelTarget: 'output-panel' },
  { label: 'Presets', panelTarget: 'preset-panel' }
]);

const QUICK_ADD_ACTIONS = Object.freeze(new Set([
  'add-sphere',
  'add-cube',
  'add-cylinder',
  'add-capsule',
  'add-torus',
  'add-area-light'
]));

const SCENE_TREE_ADD_ACTIONS = Object.freeze(
  PRIMITIVE_ACTIONS.filter((item) => QUICK_ADD_ACTIONS.has(item.action))
);

const SCENE_TREE_HEADER_STYLE = [
  'min-height: 32px',
  'box-sizing: border-box',
  'margin: -14px -14px 12px',
  'padding: 5px 8px 5px 10px',
  'display: flex',
  'align-items: center',
  'justify-content: space-between',
  'gap: 8px',
  'color: #edf1f4',
  'background: linear-gradient(180deg, rgba(58, 64, 72, 0.98), rgba(35, 39, 45, 0.98))',
  'border-bottom: 1px solid rgba(21, 24, 28, 0.82)',
  'user-select: none'
].join('; ');

const SCENE_TREE_HEADER_COUNT_STYLE = 'margin-bottom: 0; min-width: 0;';
const SCENE_TREE_COLLAPSED_GROUP_STORAGE_KEY = 'pathtracer.sceneTree.collapsedGroupIds';
const SCENE_TREE_DRAG_DATA_TYPE = 'application/x-pathtracer-scene-item-ids';
const SCENE_TREE_ROOT_DROP_ID = 'scene-tree-root-drop-target';
const SCENE_TREE_COMPONENT_SUB_ROW_KEYS = Object.freeze(new Set(['material', 'physics', 'animation']));
const SCENE_TREE_COMPONENT_CHIP_STYLE = [
  'border: 1px solid rgba(255,255,255,0.14)',
  'border-radius: 999px',
  'color: #aeb7c2',
  'font-size: 11px',
  'line-height: 1.45',
  'min-width: 0',
  'max-width: 100%',
  'overflow: hidden',
  'padding: 1px 6px',
  'text-overflow: ellipsis',
  'white-space: nowrap'
].join('; ');

const readLocalStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch (error) {
    uiLogger.warn('ui:scene-tree-storage-unavailable', { error });
    return null;
  }
};

const readStoredCollapsedGroupIds = () => {
  const storage = readLocalStorage();
  if (!storage) {
    return new Set();
  }

  try {
    const storedValue = storage.getItem(SCENE_TREE_COLLAPSED_GROUP_STORAGE_KEY);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    if (!Array.isArray(parsedValue)) {
      return new Set();
    }
    return new Set(
      parsedValue
        .filter((itemId) => itemId !== null && itemId !== undefined && itemId !== '')
        .map((itemId) => String(itemId))
    );
  } catch (error) {
    uiLogger.warn('ui:scene-tree-collapsed-groups-read-failed', {
      storageKey: SCENE_TREE_COLLAPSED_GROUP_STORAGE_KEY,
      error
    });
    return new Set();
  }
};

const writeStoredCollapsedGroupIds = (collapsedGroupIds) => {
  const storage = readLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      SCENE_TREE_COLLAPSED_GROUP_STORAGE_KEY,
      JSON.stringify(Array.from(collapsedGroupIds).sort())
    );
  } catch (error) {
    uiLogger.warn('ui:scene-tree-collapsed-groups-write-failed', {
      storageKey: SCENE_TREE_COLLAPSED_GROUP_STORAGE_KEY,
      collapsedGroupIds: Array.from(collapsedGroupIds),
      error
    });
  }
};

const collectSceneTreeGroupIds = (nodes, groupIds = new Set()) => {
  nodes.forEach((node) => {
    if (node.children.length > 0) {
      groupIds.add(node.item.id);
      collectSceneTreeGroupIds(node.children, groupIds);
    }
  });
  return groupIds;
};

const normalizeSceneTreeItemId = (itemId) => (
  itemId === null || itemId === undefined || itemId === '' ? null : String(itemId)
);

const flattenVisibleSceneTreeItems = (nodes, collapsedGroupIds, items = []) => {
  nodes.forEach((node) => {
    items.push(node.item);
    if (node.children.length > 0 && !collapsedGroupIds.has(node.item.id)) {
      flattenVisibleSceneTreeItems(node.children, collapsedGroupIds, items);
    }
  });
  return items;
};

const mergeSceneTreeSelectionIds = (...itemIdGroups) => {
  const mergedItemIds = [];
  const seenItemIds = new Set();
  itemIdGroups.forEach((itemIds) => {
    itemIds.forEach((itemId) => {
      const normalizedItemId = normalizeSceneTreeItemId(itemId);
      if (normalizedItemId !== null && !seenItemIds.has(normalizedItemId)) {
        seenItemIds.add(normalizedItemId);
        mergedItemIds.push(normalizedItemId);
      }
    });
  });
  return mergedItemIds;
};

const readSceneTreeSelectionRangeIds = (items, anchorItemId, itemId) => {
  const anchorIndex = items.findIndex((item) => item.id === anchorItemId);
  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (anchorIndex === -1 || itemIndex === -1) {
    return itemId === null ? [] : [itemId];
  }

  const startIndex = Math.min(anchorIndex, itemIndex);
  const endIndex = Math.max(anchorIndex, itemIndex);
  return items.slice(startIndex, endIndex + 1).map((item) => item.id);
};

const readSceneTreeSelectionAnchorId = (candidateItemIds, visibleItems, fallbackItemId) => {
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));
  for (const itemId of candidateItemIds) {
    const normalizedItemId = normalizeSceneTreeItemId(itemId);
    if (normalizedItemId !== null && visibleItemIds.has(normalizedItemId)) {
      return normalizedItemId;
    }
  }
  return fallbackItemId;
};

const readSceneTreeSelectionLabel = (selectedCount) => {
  if (selectedCount === 0) {
    return 'No selection';
  }
  return `${selectedCount} selected`;
};

const findVisibleSceneTreeItem = (items, itemId) => (
  items.find((item) => item.id === itemId) || null
);

const collectSceneTreeNodeItemIds = (node, itemIds = []) => {
  itemIds.push(node.item.id);
  node.children.forEach((childNode) => collectSceneTreeNodeItemIds(childNode, itemIds));
  return itemIds;
};

const findSceneTreeNode = (nodes, itemId) => {
  for (const node of nodes) {
    if (node.item.id === itemId) {
      return node;
    }
    const childNode = findSceneTreeNode(node.children, itemId);
    if (childNode) {
      return childNode;
    }
  }
  return null;
};

const writeSceneTreeDragItemIds = (event, itemIds) => {
  const dragItemIds = mergeSceneTreeSelectionIds(itemIds);
  if (!event.dataTransfer || dragItemIds.length === 0) {
    return;
  }

  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(SCENE_TREE_DRAG_DATA_TYPE, JSON.stringify(dragItemIds));
  event.dataTransfer.setData('text/plain', dragItemIds.join(', '));
};

const readSceneTreeDragItemIds = (event, fallbackItemIds = []) => {
  const fallbackDragItemIds = mergeSceneTreeSelectionIds(fallbackItemIds);
  if (!event.dataTransfer) {
    return fallbackDragItemIds;
  }

  try {
    const rawItemIds = event.dataTransfer.getData(SCENE_TREE_DRAG_DATA_TYPE);
    const parsedItemIds = rawItemIds ? JSON.parse(rawItemIds) : [];
    const dragItemIds = Array.isArray(parsedItemIds) ? mergeSceneTreeSelectionIds(parsedItemIds) : [];
    return dragItemIds.length > 0 ? dragItemIds : fallbackDragItemIds;
  } catch (error) {
    uiLogger.warn('ui:scene-tree-drag-data-read-failed', { error });
    return fallbackDragItemIds;
  }
};

const formatItemLabel = (item) => {
  const status = [
    item.isHidden ? 'hidden' : '',
    item.isLocked ? 'locked' : ''
  ].filter(Boolean).join(', ');
  const label = item.name || `Scene item #${item.index}`;
  return status ? `${label} (${status})` : label;
};

const MAX_VISIBLE_COMPONENT_CHIPS = 4;

const isSceneTreeComponentSubRow = (item, row) => (
  row.key === 'physics'
    ? Boolean(item.physicsRigidBody)
    : SCENE_TREE_COMPONENT_SUB_ROW_KEYS.has(row.key)
);

const renderComponentSubRows = (item, depth) => {
  const rows = readSceneItemComponentRows(item)
    .filter((row) => isSceneTreeComponentSubRow(item, row));
  if (rows.length === 0) {
    return null;
  }

  return rows.map((row) => html`
    <div
      key=${`component-row-${row.key}`}
      className="scene-tree-component-row"
      role="presentation"
      title=${row.summary ? `${row.label}: ${row.summary}` : row.label}
      style=${`margin-left: ${depth * 12 + 22}px;`}
    >
      <span>${row.label}</span>
      <strong>${row.summary || 'Attached'}</strong>
    </div>
  `);
};

const renderComponentChips = (item, depth) => {
  const rows = readSceneItemComponentRows(item);
  if (rows.length === 0) {
    return null;
  }

  const visibleRows = rows.slice(0, MAX_VISIBLE_COMPONENT_CHIPS);
  const hiddenRowCount = rows.length - visibleRows.length;
  return html`
    <div
      className="scene-tree-component-chips"
      style=${`padding-left: ${depth * 12 + 22}px; display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 2px; max-width: 100%;`}
      aria-label=${`${item.name || 'Scene item'} components`}
    >
      ${visibleRows.map((row) => html`
        <span
          key=${row.key}
          className="scene-tree-component-chip"
          title=${row.summary ? `${row.label}: ${row.summary}` : row.label}
          style=${SCENE_TREE_COMPONENT_CHIP_STYLE}
        >
          ${row.summary ? `${row.label}: ${row.summary}` : row.label}
        </span>
      `)}
      ${hiddenRowCount > 0 ? html`
        <span
          key="hidden-component-count"
          className="scene-tree-component-chip"
          title=${`${hiddenRowCount} more components`}
          style=${SCENE_TREE_COMPONENT_CHIP_STYLE}
        >
          +${hiddenRowCount}
        </span>
      ` : null}
    </div>
  `;
};

const renderSceneTreeNode = (
  node,
  currentSelectedId,
  selectedItemIdSet,
  collapsedGroupIds,
  onSelectItem,
  onToggleGroup,
  dragState,
  dragHandlers
) => {
  const { item, children, depth } = node;
  const { draggedItemIdSet, dragOverItemId } = dragState;
  const isPrimarySelected = item.id === currentSelectedId;
  const isSecondarySelected = !isPrimarySelected && selectedItemIdSet.has(item.id);
  const isSelected = isPrimarySelected || isSecondarySelected;
  const selectionState = isPrimarySelected ? 'primary' : (isSecondarySelected ? 'secondary' : undefined);
  const hasChildren = children.length > 0;
  const isExpanded = hasChildren && !collapsedGroupIds.has(item.id);
  const isDragged = draggedItemIdSet.has(item.id);
  const isDropTarget = dragOverItemId === item.id;
  return html`
    <li key=${item.id} role="none" data-scene-tree-depth=${depth}>
      <button
        type="button"
        role="treeitem"
        draggable=${true}
        data-scene-object-id=${item.id}
        data-scene-object-index=${item.index}
        data-parent-entity-id=${item.parentEntityId ?? undefined}
        data-display-order=${item.displayOrder}
        data-group-name=${item.groupName ?? undefined}
        data-scene-item-kind=${item.sceneItemKind}
        aria-level=${depth + 1}
        aria-expanded=${hasChildren ? String(isExpanded) : undefined}
        aria-selected=${String(isSelected)}
        aria-pressed=${String(isSelected)}
        aria-current=${isPrimarySelected ? 'true' : undefined}
        aria-grabbed=${isDragged ? 'true' : undefined}
        data-selection-state=${selectionState}
        data-drag-state=${isDragged ? 'source' : undefined}
        data-drop-state=${isDropTarget ? 'target' : undefined}
        title=${formatItemLabel(item)}
        onClick=${(event) => onSelectItem(item, event)}
        onDragStart=${(event) => dragHandlers.onDragStart(item, event)}
        onDragOver=${(event) => dragHandlers.onDragOver(item, event)}
        onDragLeave=${(event) => dragHandlers.onDragLeave(item, event)}
        onDrop=${(event) => dragHandlers.onDrop(item, event)}
        onDragEnd=${dragHandlers.onDragEnd}
        onKeyDown=${hasChildren ? (event) => {
          if (
            (event.key === 'ArrowRight' && !isExpanded) ||
            (event.key === 'ArrowLeft' && isExpanded)
          ) {
            event.preventDefault();
            onToggleGroup(item.id);
          }
        } : undefined}
      >
        <span className="scene-tree-row" style="display: flex; align-items: center; gap: 6px; width: 100%;">
          <span
            className="scene-tree-chevron"
            aria-hidden="true"
            data-expanded=${hasChildren ? String(isExpanded) : undefined}
            title=${hasChildren ? (isExpanded ? 'Collapse group' : 'Expand group') : undefined}
            style="display: inline-flex; width: 16px; justify-content: center;"
            onClick=${hasChildren ? (event) => {
              event.stopPropagation();
              onToggleGroup(item.id);
            } : undefined}
          ></span>
          <span className="scene-tree-label" style=${`padding-left: ${depth * 12}px`}>
            ${formatItemLabel(item)}
          </span>
        </span>
      </button>
      ${renderComponentSubRows(item, depth)}
      ${renderComponentChips(item, depth)}
      ${hasChildren && isExpanded ? html`
        <ul role="group" style="list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 4px;">
          ${children.map((childNode) => renderSceneTreeNode(
            childNode,
            currentSelectedId,
            selectedItemIdSet,
            collapsedGroupIds,
            onSelectItem,
            onToggleGroup,
            dragState,
            dragHandlers
          ))}
        </ul>
      ` : null}
    </li>
  `;
};

export function SceneTreeWindow({
  id = 'scene-tree-window',
  defaultPosition = { top: 48, left: 18, width: 320, height: 'min(74vh, 680px)' },
  onSelectItem
}) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(readStoredCollapsedGroupIds);
  const [selectionAnchorId, setSelectionAnchorId] = useState(null);
  const [draggedItemIds, setDraggedItemIds] = useState(Object.freeze([]));
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const isCreateOpen = isSceneTreeCreateMenuOpen.value;
  const isWindowVisible = uiWindowVisibilitySignals['scene-tree-window'].value;
  const treeRoots = sceneTreeRoots.value;
  const currentSelectedId = normalizeSceneTreeItemId(selectedItemId.value);
  const currentSelectedItemIds = selectedItemIds.value.length > 0
    ? selectedItemIds.value
    : (currentSelectedId === null ? [] : [currentSelectedId]);
  const selectedItemIdSet = new Set(currentSelectedItemIds);
  const selectedCount = currentSelectedItemIds.length;
  const visibleTreeItems = flattenVisibleSceneTreeItems(treeRoots, collapsedGroupIds);
  const draggedItemIdSet = new Set(draggedItemIds);

  useEffect(() => {
    if (!isWindowVisible && isCreateOpen) {
      setSceneTreeCreateMenuOpen(false);
    }
  }, [isCreateOpen, isWindowVisible]);

  useEffect(() => {
    writeStoredCollapsedGroupIds(collapsedGroupIds);
  }, [collapsedGroupIds]);

  useEffect(() => {
    if (treeRoots.length === 0 || collapsedGroupIds.size === 0) {
      return;
    }

    const groupIds = collectSceneTreeGroupIds(treeRoots);
    const nextCollapsedGroupIds = new Set();
    collapsedGroupIds.forEach((itemId) => {
      if (groupIds.has(itemId)) {
        nextCollapsedGroupIds.add(itemId);
      }
    });

    if (nextCollapsedGroupIds.size !== collapsedGroupIds.size) {
      setCollapsedGroupIds(nextCollapsedGroupIds);
    }
  }, [collapsedGroupIds, treeRoots]);

  const handleSelect = (item, event) => {
    const itemId = normalizeSceneTreeItemId(item.id);
    if (itemId === null) {
      return;
    }

    const isRangeSelection = Boolean(event && event.shiftKey);
    const isToggleSelection = Boolean(event && (event.ctrlKey || event.metaKey));
    const selectedNode = findSceneTreeNode(treeRoots, itemId);
    const clickedItemIds = selectedNode && item.sceneItemKind === 'group'
      ? collectSceneTreeNodeItemIds(selectedNode)
      : [itemId];
    let nextSelectedItemIds = clickedItemIds;
    let nextPrimaryItemId = itemId;
    let nextSelectionAnchorId = itemId;

    if (isRangeSelection) {
      const anchorItemId = readSceneTreeSelectionAnchorId(
        [selectionAnchorId, currentSelectedId],
        visibleTreeItems,
        itemId
      );
      const rangeItemIds = readSceneTreeSelectionRangeIds(visibleTreeItems, anchorItemId, itemId);
      nextSelectedItemIds = isToggleSelection
        ? mergeSceneTreeSelectionIds(currentSelectedItemIds, rangeItemIds)
        : rangeItemIds;
      nextSelectionAnchorId = anchorItemId;
    } else if (isToggleSelection) {
      if (selectedItemIdSet.has(itemId)) {
        const clickedItemIdSet = new Set(clickedItemIds);
        nextSelectedItemIds = currentSelectedItemIds.filter((selectedItemId) => !clickedItemIdSet.has(selectedItemId));
        nextPrimaryItemId = currentSelectedId === itemId
          ? nextSelectedItemIds[nextSelectedItemIds.length - 1] ?? null
          : currentSelectedId;
      } else {
        nextSelectedItemIds = mergeSceneTreeSelectionIds(currentSelectedItemIds, clickedItemIds);
      }
    }

    setSelectedItemIds(nextSelectedItemIds, nextPrimaryItemId);
    setSelectionAnchorId(nextSelectionAnchorId);
    uiLogger.info('ui:scene-tree-selection', {
      itemId,
      primaryItemId: nextPrimaryItemId,
      selectedItemIds: nextSelectedItemIds,
      mode: isRangeSelection ? 'range' : (isToggleSelection ? 'toggle' : 'single')
    });
    if (onSelectItem && nextPrimaryItemId !== null) {
      onSelectItem(findVisibleSceneTreeItem(visibleTreeItems, nextPrimaryItemId) || item);
    }
  };

  const handlePanelLink = (panelTarget) => {
    uiLogger.info('ui:scene-tree-panel-link', { panelTarget });
    setUiWindowVisible('controls', true);
    openUiPanel(panelTarget);
  };

  const handleCreateShortcutClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    uiLogger.info('ui:scene-tree-create-shortcut', { nextOpen: !isSceneTreeCreateMenuOpen.value });
    toggleSceneTreeCreateMenuOpen();
  };

  const handleAddActionClick = (event) => {
    const windowObject = event.currentTarget.ownerDocument.defaultView || globalThis;
    uiLogger.info('ui:scene-tree-add-action', {
      action: event.currentTarget.dataset.action || null
    });
    windowObject.setTimeout(() => setSceneTreeCreateMenuOpen(false), 0);
  };

  const handleToggleGroup = (itemId) => {
    setCollapsedGroupIds((currentValue) => {
      const nextValue = new Set(currentValue);
      const normalizedItemId = String(itemId);
      if (nextValue.has(normalizedItemId)) {
        nextValue.delete(normalizedItemId);
      } else {
        nextValue.add(normalizedItemId);
      }
      uiLogger.info('ui:scene-tree-group-toggle', {
        itemId: normalizedItemId,
        nextCollapsed: nextValue.has(normalizedItemId)
      });
      return nextValue;
    });
  };

  const handleGroupSelected = () => {
    const groupItem = groupSelectedSceneItems();
    if (!groupItem) {
      uiLogger.info('ui:scene-tree-group-selected-noop', { selectedItemIds: currentSelectedItemIds });
      return;
    }

    setCollapsedGroupIds((currentValue) => {
      if (!currentValue.has(groupItem.id)) {
        return currentValue;
      }
      const nextValue = new Set(currentValue);
      nextValue.delete(groupItem.id);
      return nextValue;
    });
    setSelectionAnchorId(groupItem.id);
    uiLogger.info('ui:scene-tree-group-selected', {
      groupId: groupItem.id,
      childEntityIds: groupItem.childEntityIds
    });
  };

  const handleUngroupSelected = () => {
    const didUngroup = ungroupSelectedSceneItems();
    uiLogger.info(didUngroup ? 'ui:scene-tree-ungroup-selected' : 'ui:scene-tree-ungroup-selected-noop', {
      selectedItemIds: currentSelectedItemIds
    });
    if (didUngroup) {
      setSelectionAnchorId(null);
    }
  };

  const handleDeleteSelected = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const didDelete = deleteSelectedSceneItems();
    uiLogger.info(didDelete ? 'ui:scene-tree-delete-selected' : 'ui:scene-tree-delete-selected-noop', {
      selectedItemIds: currentSelectedItemIds
    });
    if (didDelete) {
      setSelectionAnchorId(null);
    }
  };

  const resetSceneTreeDragState = () => {
    setDraggedItemIds(Object.freeze([]));
    setDragOverItemId(null);
  };

  const handleDragStart = (item, event) => {
    const itemId = normalizeSceneTreeItemId(item.id);
    if (itemId === null) {
      return;
    }

    const nextDraggedItemIds = selectedItemIdSet.has(itemId)
      ? currentSelectedItemIds
      : [itemId];
    writeSceneTreeDragItemIds(event, nextDraggedItemIds);
    setDraggedItemIds(Object.freeze([...nextDraggedItemIds]));
    setDragOverItemId(null);
    uiLogger.debug('ui:scene-tree-drag-start', {
      itemId,
      draggedItemIds: nextDraggedItemIds
    });

    if (!selectedItemIdSet.has(itemId)) {
      setSelectedItemIds(nextDraggedItemIds, itemId);
      setSelectionAnchorId(itemId);
      if (onSelectItem) {
        onSelectItem(item);
      }
    }
  };

  const handleDragOver = (item, event) => {
    const itemId = normalizeSceneTreeItemId(item.id);
    if (itemId === null || draggedItemIds.length === 0) {
      return;
    }

    event.stopPropagation();
    if (!canReparentSceneItems(draggedItemIds, itemId)) {
      uiLogger.debug('ui:scene-tree-drop-rejected', {
        targetItemId: itemId,
        draggedItemIds
      });
      setDragOverItemId(null);
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setDragOverItemId((currentItemId) => (currentItemId === itemId ? currentItemId : itemId));
  };

  const handleDragLeave = (item, event) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    const itemId = normalizeSceneTreeItemId(item.id);
    setDragOverItemId((currentItemId) => (currentItemId === itemId ? null : currentItemId));
  };

  const handleDrop = (item, event) => {
    const itemId = normalizeSceneTreeItemId(item.id);
    const droppedItemIds = readSceneTreeDragItemIds(event, draggedItemIds);
    event.preventDefault();
    event.stopPropagation();

    const didReparent = itemId !== null && reparentSceneItems(droppedItemIds, itemId);
    uiLogger.info(didReparent ? 'ui:scene-tree-drop' : 'ui:scene-tree-drop-noop', {
      targetItemId: itemId,
      droppedItemIds
    });
    if (didReparent) {
      setCollapsedGroupIds((currentValue) => {
        if (!currentValue.has(itemId)) {
          return currentValue;
        }
        const nextValue = new Set(currentValue);
        nextValue.delete(itemId);
        return nextValue;
      });
    }
    resetSceneTreeDragState();
  };

  const handleRootDragOver = (event) => {
    if (event.target !== event.currentTarget || draggedItemIds.length === 0) {
      return;
    }
    if (!canReparentSceneItems(draggedItemIds, null)) {
      uiLogger.debug('ui:scene-tree-root-drop-rejected', { draggedItemIds });
      setDragOverItemId(null);
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setDragOverItemId((currentItemId) => (
      currentItemId === SCENE_TREE_ROOT_DROP_ID ? currentItemId : SCENE_TREE_ROOT_DROP_ID
    ));
  };

  const handleRootDragLeave = (event) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setDragOverItemId((currentItemId) => (
      currentItemId === SCENE_TREE_ROOT_DROP_ID ? null : currentItemId
    ));
  };

  const handleRootDrop = (event) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const droppedItemIds = readSceneTreeDragItemIds(event, draggedItemIds);
    event.preventDefault();
    const didReparent = reparentSceneItems(droppedItemIds, null);
    uiLogger.info(didReparent ? 'ui:scene-tree-root-drop' : 'ui:scene-tree-root-drop-noop', {
      droppedItemIds
    });
    resetSceneTreeDragState();
  };

  const dragState = {
    draggedItemIdSet,
    dragOverItemId
  };
  const dragHandlers = {
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onDragEnd: resetSceneTreeDragState
  };
  const canGroupSelection = canGroupSceneItems(currentSelectedItemIds);
  const canUngroupSelection = canUngroupSceneItems(currentSelectedItemIds);
  const canDeleteSelection = canDeleteSceneItems(currentSelectedItemIds);

  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="scene-tree"
      title="Scene Tree"
      defaultPosition=${defaultPosition}
      defaultVisible=${true}
      visibleSignal=${uiWindowVisibilitySignals['scene-tree-window']}
    >
      <div className="scene-tree-create" open=${isCreateOpen ? true : undefined}>
        <div id="scene-tree-header" style=${SCENE_TREE_HEADER_STYLE}>
          <span id="scene-tree-count" className="scene-tree-summary" style=${SCENE_TREE_HEADER_COUNT_STYLE}>
            ${sceneItemCountLabel.value}
          </span>
          <div className="floating-window-actions">
            <button
              type="button"
              data-panel-target=${SCENE_TREE_CREATE_PANEL_ID}
              aria-hidden="true"
              tabIndex=${-1}
              style="display: none;"
              onClick=${handleCreateShortcutClick}
            ></button>
            <button
              id="scene-tree-add"
              type="button"
              aria-label="Add primitive"
              aria-controls="scene-tree-add-menu"
              aria-expanded=${String(isCreateOpen)}
              aria-pressed=${String(isCreateOpen)}
              title="Add primitive (Ctrl+1)"
              onClick=${handleCreateShortcutClick}
            >
              <span className="scene-tree-add-plus" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <menu
          id="scene-tree-add-menu"
          className="scene-tree-add-popover"
          role="menu"
          aria-label="Add primitive"
          aria-hidden=${String(!isCreateOpen)}
          style=${`margin: 0; display: ${isCreateOpen ? 'grid' : 'none'};`}
        >
          ${SCENE_TREE_ADD_ACTIONS.map((item) => html`
            <button
              key=${item.action}
              className=${item.className}
              type="button"
              role="menuitem"
              data-action=${item.action}
              onClick=${handleAddActionClick}
            >
              ${item.label}
            </button>
          `)}
        </menu>
      </div>

      <div className="scene-tree-tools">
        <div className="section-title">Selection</div>
        <div className="scene-tree-selection-count" role="status" aria-live="polite">
          ${readSceneTreeSelectionLabel(selectedCount)}
        </div>
        <button type="button" data-action="select-light">Select Light</button>
        <button type="button" data-action="delete-selection" disabled=${!canDeleteSelection} onClick=${handleDeleteSelected}>Delete Selected</button>
        <button
          type="button"
          data-action="group-selection"
          disabled=${!canGroupSelection}
          title="Group selected items"
          onClick=${handleGroupSelected}
        >
          Group Selected
        </button>
        <button
          type="button"
          data-action="ungroup-selection"
          disabled=${!canUngroupSelection}
          title="Ungroup selected group items"
          onClick=${handleUngroupSelected}
        >
          Ungroup
        </button>
        <button type="button" disabled=${true} title="CSG Merge action scaffold">CSG Merge</button>
        <div className="section-title">Settings</div>
        ${PANEL_LINKS.map((item) => html`
          <button
            key=${item.panelTarget}
            type="button"
            data-panel-target=${item.panelTarget}
            data-window-target="controls"
            onClick=${() => handlePanelLink(item.panelTarget)}
          >
            ${item.label}
          </button>
        `)}
      </div>

      <ul
        id="scene-tree-list"
        className="scene-tree-list"
        role="tree"
        aria-label="Scene items"
        data-drag-active=${draggedItemIds.length > 0 ? 'true' : undefined}
        data-drop-state=${dragOverItemId === SCENE_TREE_ROOT_DROP_ID ? 'target' : undefined}
        style="list-style: none; padding: 0; margin: 0;"
        onDragOver=${handleRootDragOver}
        onDragLeave=${handleRootDragLeave}
        onDrop=${handleRootDrop}
      >
        ${treeRoots.map((node) => renderSceneTreeNode(
          node,
          currentSelectedId,
          selectedItemIdSet,
          collapsedGroupIds,
          handleSelect,
          handleToggleGroup,
          dragState,
          dragHandlers
        ))}
      </ul>
    <//>
  `;
}
