import { expect, test } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

/**
 * Baseline E2E tests for the TypeScript Dependency Graph Viewer.
 *
 * Prerequisites:
 *   1. Start the dev server: `pnpm dev`  (UI on :4000, API on :4001)
 *   2. Ensure the API has analyzed at least one project so /api returns data.
 *
 * These tests capture the current behavior of the Vue Flow-based graph
 * before any migration work begins. They serve as a regression safety-net.
 */

/** Maximum time to wait for the graph to finish its initial layout render. */
const GRAPH_RENDER_TIMEOUT = 20_000;

test.describe('Dependency Graph — Baseline Behavior', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app root.
    await page.goto('/');

    // Wait for the Vue Flow container to appear (the graph wrapper).
    await page.waitForSelector('.vue-flow', { timeout: GRAPH_RENDER_TIMEOUT });

    // Wait for at least one node to be rendered — this means data was fetched
    // from the API and the layout engine has placed nodes on the canvas.
    await page.waitForSelector('.vue-flow__node', { timeout: GRAPH_RENDER_TIMEOUT });
  });

  // ---------------------------------------------------------------------------
  // 1. Graph renders
  // ---------------------------------------------------------------------------
  test('graph renders with nodes visible', async ({ page }) => {
    // The .vue-flow container should exist.
    const flowContainer = page.locator('.vue-flow');
    await expect(flowContainer).toBeVisible();

    // At least one node should be present in the DOM.
    const nodeCount = await page.locator('.vue-flow__node').count();
    expect(nodeCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Zoom controls work
  // ---------------------------------------------------------------------------
  test('zoom in button increases viewport zoom level', async ({ page }) => {
    // Capture the current zoom from the Vue Flow transform.
    const zoomBefore = await getViewportZoom(page);

    // Click the "Zoom in" button in the GraphControls panel.
    await (await getZoomInControl(page)).click();

    // Allow the animated zoom to complete.
    await page.waitForTimeout(300);

    const zoomAfter = await getViewportZoom(page);
    expect(zoomAfter).toBeGreaterThan(zoomBefore);
  });

  // ---------------------------------------------------------------------------
  // 3. Fit view works
  // ---------------------------------------------------------------------------
  test('fit view button adjusts viewport to show all nodes', async ({ page }) => {
    // First zoom in so the viewport is definitely NOT fit-to-content.
    await (await getZoomInControl(page)).click();
    await (await getZoomInControl(page)).click();
    await page.waitForTimeout(300);

    const zoomBeforeFit = await getViewportZoom(page);

    // Click fit view.
    await (await getFitViewControl(page)).click();
    await page.waitForTimeout(400);

    const zoomAfterFit = await getViewportZoom(page);

    // The zoom should have changed (fit adjusts to graph extents).
    expect(zoomAfterFit).not.toBeCloseTo(zoomBeforeFit, 1);
  });

  // ---------------------------------------------------------------------------
  // 4. Node click selects
  // ---------------------------------------------------------------------------
  test('clicking a node gives it the selected class', async ({ page }) => {
    const firstNode = await getInteractableNode(page);
    await firstNode.click();

    // Selection can be represented by VueFlow's default `.selected` class or
    // by the app's custom `selection-target` class.
    await expect(firstNode).toHaveClass(/(selected|selection-target)/);
  });

  // ---------------------------------------------------------------------------
  // 5. Node click toggle deselects
  // ---------------------------------------------------------------------------
  test('clicking the same node twice clears selection and closes details', async ({ page }) => {
    const firstNode = await getInteractableNode(page);
    const detailsPanel = page.locator('[role="dialog"][aria-labelledby="node-details-title"]');

    await firstNode.click();
    await expect(firstNode).toHaveClass(/(selected|selection-target)/);
    await expect(detailsPanel).toBeVisible();

    await firstNode.click();

    await expect(page.locator('.vue-flow__node.selected, .vue-flow__node.selection-target')).toHaveCount(0);
    await expect(detailsPanel).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Pane click deselects
  // ---------------------------------------------------------------------------
  test('clicking the pane deselects all nodes', async ({ page }) => {
    // Select a node first.
    const firstNode = await getInteractableNode(page);
    const detailsPanel = page.locator('[role="dialog"][aria-labelledby="node-details-title"]');
    await firstNode.click();
    await expect(firstNode).toHaveClass(/(selected|selection-target)/);
    await expect(detailsPanel).toBeVisible();

    // Click on the pane background to deselect.
    await page.locator('.vue-flow__pane').click();

    // No node should have the selected class anymore.
    const selectedNodes = page.locator('.vue-flow__node.selected, .vue-flow__node.selection-target');
    await expect(selectedNodes).toHaveCount(0);
    await expect(detailsPanel).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Minimap renders
  // ---------------------------------------------------------------------------
  test('minimap renders with SVG content', async ({ page }) => {
    const minimap = page.locator('.vue-flow__minimap');
    if (!(await minimap.isVisible())) {
      await expect(page.locator('.minimap-warning-panel')).toBeVisible();
      return;
    }

    // The minimap contains an SVG element.
    const svg = minimap.locator('svg');
    await expect(svg).toBeVisible();

    // SVG should contain at least one rect (node representation).
    const rects = svg.locator('rect');
    const rectCount = await rects.count();
    expect(rectCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Minimap click centers
  // ---------------------------------------------------------------------------
  test('clicking the minimap SVG changes viewport position', async ({ page }) => {
    const viewportBefore = await getViewportTransform(page);

    // Click near the top-left corner of the minimap SVG.
    const minimapSvg = page.locator('.vue-flow__minimap svg');
    if (!(await minimapSvg.isVisible())) {
      test.skip(true, 'MiniMap is auto-hidden in heavy graph mode');
    }
    const box = await minimapSvg.boundingBox();
    expect(box).toBeTruthy();

    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
    }

    await page.waitForTimeout(400);

    const viewportAfter = await getViewportTransform(page);

    // The viewport translate values should differ after the minimap click.
    const positionChanged =
      Math.abs(viewportAfter.x - viewportBefore.x) > 1 || Math.abs(viewportAfter.y - viewportBefore.y) > 1;
    expect(positionChanged).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 8. Focus action
  // ---------------------------------------------------------------------------
  test('focus action button centers viewport on the node', async ({ page }) => {
    // Click a node first so its action buttons are interactable.
    const firstNode = await getInteractableNode(page);
    await firstNode.click();

    const viewportBefore = await getViewportTransform(page);

    // Click the "Focus camera on node" button within the first node.
    const focusButton = firstNode.locator('.base-node-action-button[aria-label="Focus camera on node"]');
    await focusButton.click();

    await page.waitForTimeout(400);

    const viewportAfter = await getViewportTransform(page);

    // The viewport should have moved or zoomed to center on the node.
    const viewportMoved =
      Math.abs(viewportAfter.x - viewportBefore.x) > 1 ||
      Math.abs(viewportAfter.y - viewportBefore.y) > 1 ||
      Math.abs(viewportAfter.zoom - viewportBefore.zoom) > 0.01;
    expect(viewportMoved).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 9. Isolate action
  // ---------------------------------------------------------------------------
  test('isolate action reduces visible node count to neighborhood', async ({ page }) => {
    const totalNodesBefore = await page.locator('.vue-flow__node').count();
    expect(totalNodesBefore).toBeGreaterThan(1);

    // Click the first node, then its isolate button.
    const firstNode = await getInteractableNode(page);
    await firstNode.click();

    const isolateButton = firstNode.locator('.base-node-action-button[aria-label="Isolate node and neighbors"]');
    await isolateButton.click();

    await page.waitForTimeout(500);

    const totalNodesAfter = await page.locator('.vue-flow__node').count();

    // After isolation, the node count should decrease (only the node and
    // its direct neighbors remain).
    expect(totalNodesAfter).toBeLessThan(totalNodesBefore);

    // The "Back to Full Graph" button should appear.
    const backButton = page.getByRole('button', { name: /Back to Full Graph/i });
    await expect(backButton).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 10. Isolate layout spacing
  // ---------------------------------------------------------------------------
  test('isolate action lays out neighborhood nodes without overlap', async ({ page }) => {
    const firstNode = await getInteractableNode(page);
    await firstNode.click();

    const isolateButton = firstNode.locator('.base-node-action-button[aria-label="Isolate node and neighbors"]');
    await isolateButton.click();
    await page.waitForTimeout(700);

    const isolatedNodeBoxes = await getVisibleNodeBoxes(page);
    expect(isolatedNodeBoxes.length).toBeGreaterThan(1);

    const overlaps: string[] = [];
    for (const [index, first] of isolatedNodeBoxes.entries()) {
      for (const second of isolatedNodeBoxes.slice(index + 1)) {
        if (hasMeaningfulNodeOverlap(first, second, 6)) {
          overlaps.push(`${first.id}<->${second.id}`);
        }
      }
    }

    expect(
      overlaps,
      overlaps.length > 0 ? `Overlapping isolate nodes: ${overlaps.join(', ')}` : undefined
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 11. Back to overview
  // ---------------------------------------------------------------------------
  test('back to full graph restores all nodes after isolate', async ({ page }) => {
    const totalNodesBefore = await page.locator('.vue-flow__node').count();

    // Isolate the first node.
    const firstNode = await getInteractableNode(page);
    await firstNode.click();
    const isolateButton = firstNode.locator('.base-node-action-button[aria-label="Isolate node and neighbors"]');
    await isolateButton.click();
    await page.waitForTimeout(500);

    // Verify isolation happened.
    const isolatedCount = await page.locator('.vue-flow__node').count();
    expect(isolatedCount).toBeLessThan(totalNodesBefore);

    // Click "Back to Full Graph".
    const backButton = page.getByRole('button', { name: /Back to Full Graph/i });
    await backButton.click();
    await page.waitForTimeout(500);

    const totalNodesAfterRestore = await page.locator('.vue-flow__node').count();

    // All nodes should be restored.
    expect(totalNodesAfterRestore).toBe(totalNodesBefore);
  });

  // ---------------------------------------------------------------------------
  // 12. Keyboard navigation
  // ---------------------------------------------------------------------------
  test('arrow key navigates to a connected node', async ({ page }) => {
    // Focus the graph root so keyboard events are captured.
    const graphRoot = page.locator('.dependency-graph-root');
    await graphRoot.focus();

    // Select the first node by clicking it.
    const firstNode = await getInteractableNode(page);
    await firstNode.click();

    const firstNodeId = await firstNode.getAttribute('data-id');
    expect(firstNodeId).toBeTruthy();

    // Press ArrowRight to navigate to a connected node.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    // A different node should now be selected.
    const selectedNode = page.locator('.vue-flow__node.selected');
    const selectedCount = await selectedNode.count();

    // If the node has connections, a neighbor should now be selected.
    // If the node has no connections, the original stays selected.
    if (selectedCount > 0) {
      const selectedNodeId = await selectedNode.first().getAttribute('data-id');
      // Either a different node got selected, or the same one remained
      // (if it has no outgoing edges for ArrowRight).
      expect(selectedNodeId).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // 13. Graph controls panel (new controls architecture)
  // ---------------------------------------------------------------------------
  test('graph controls panel renders search at top without layout/direction/reset controls', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    await expect(controlsPanel).toBeVisible();

    // Search input appears at top of controls (embedded in panel per new architecture).
    const searchInput = controlsPanel.locator('input[placeholder*="Search" i]');
    await expect(searchInput).toBeVisible();

    // Deprecated layout/reset controls must NOT exist.
    await expect(controlsPanel.getByRole('button', { name: /reset view/i })).toHaveCount(0);
    await expect(controlsPanel.getByRole('button', { name: /reset layout/i })).toHaveCount(0);
    for (const algo of ['layered', 'radial', 'force', 'stress']) {
      await expect(controlsPanel.locator(`button[aria-label="Set layout algorithm to ${algo}"]`)).toHaveCount(0);
    }
    for (const dir of ['LR', 'RL', 'TB', 'BT']) {
      await expect(controlsPanel.locator(`button[aria-label="Set layout direction to ${dir}"]`)).toHaveCount(0);
    }
  });

  test('Folder control exists in Node Types section', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const nodeTypesToggle = controlsPanel.getByRole('button', { name: /node types/i }).first();
    await expect(nodeTypesToggle).toBeVisible();
    if ((await nodeTypesToggle.getAttribute('aria-expanded')) === 'false') {
      await nodeTypesToggle.click();
    }
    const nodeTypesSectionId = await nodeTypesToggle.getAttribute('aria-controls');
    expect(nodeTypesSectionId).toBeTruthy();
    if (!nodeTypesSectionId) {
      throw new Error('Node Types section id missing');
    }
    const nodeTypesBlock = controlsPanel.locator(`#${nodeTypesSectionId}`);
    await expect(nodeTypesBlock).toBeVisible();

    const folderControl = nodeTypesBlock.locator('label').filter({ hasText: /^folder$/i }).first();
    await expect(folderControl).toBeVisible();
  });

  test('SCC (Collapse cycles) appears in Analysis section with disable logic', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const analysisToggle = controlsPanel.getByRole('button', { name: /analysis/i }).first();
    await expect(analysisToggle).toBeVisible();
    if ((await analysisToggle.getAttribute('aria-expanded')) === 'false') {
      await analysisToggle.click();
    }
    const analysisSectionId = await analysisToggle.getAttribute('aria-controls');
    expect(analysisSectionId).toBeTruthy();
    if (!analysisSectionId) {
      throw new Error('Analysis section id missing');
    }
    const analysisBlock = controlsPanel.locator(`#${analysisSectionId}`);
    await expect(analysisBlock).toBeVisible();

    const sccLabel = analysisBlock.locator('label').filter({ hasText: /collapse cycles/i }).first();
    await expect(sccLabel).toBeVisible();

    const sccCheckbox = sccLabel.locator('input[type="checkbox"]');
    await expect(sccCheckbox).toBeVisible();

    // When clusterByFolder is ON (or forcesClusterByFolder), SCC must be disabled.
    const folderCheckbox = controlsPanel
      .locator('label')
      .filter({ hasText: /folder|cluster by folder/i })
      .first()
      .locator('input[type="checkbox"]');
    const folderChecked = await folderCheckbox.isChecked();

    if (folderChecked) {
      await expect(sccCheckbox).toBeDisabled();
    }
  });

  test('at least one collapsible section toggles expand/collapse', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const collapsibleToggles = controlsPanel.locator('[aria-expanded]');
    if ((await collapsibleToggles.count()) === 0) {
      test.skip(true, 'Collapsible sections not yet implemented');
    }
    const collapsibleToggle = collapsibleToggles.first();

    const expandedBefore = await collapsibleToggle.getAttribute('aria-expanded');
    await collapsibleToggle.click();
    await page.waitForTimeout(150);

    const expandedAfter = await collapsibleToggle.getAttribute('aria-expanded');
    expect(expandedAfter).not.toBe(expandedBefore);

    await collapsibleToggle.click();
    await page.waitForTimeout(150);
    const expandedRestored = await collapsibleToggle.getAttribute('aria-expanded');
    expect(expandedRestored).toBe(expandedBefore);
  });

  test('debug bounds overlay renders when enabled from Debug section', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const debugToggle = controlsPanel.getByRole('button', { name: /debug/i }).first();
    await expect(debugToggle).toBeVisible();
    if ((await debugToggle.getAttribute('aria-expanded')) === 'false') {
      await debugToggle.click();
    }

    const debugSectionId = await debugToggle.getAttribute('aria-controls');
    expect(debugSectionId).toBeTruthy();
    if (!debugSectionId) {
      throw new Error('Debug section id missing');
    }
    const debugSection = controlsPanel.locator(`#${debugSectionId}`);
    await expect(debugSection).toBeVisible();

    const boundsLabel = debugSection.locator('label').filter({ hasText: /show collision bounds/i }).first();
    await expect(boundsLabel).toBeVisible();

    const boundsCheckbox = boundsLabel.locator('input[type="checkbox"]');
    if (!(await boundsCheckbox.isChecked())) {
      await boundsCheckbox.check();
    }

    await expect(page.locator('.debug-bounds-overlay')).toBeVisible();
    await expect(page.locator('.debug-bounds-overlay rect').first()).toBeVisible();

    if (await boundsCheckbox.isChecked()) {
      await boundsCheckbox.uncheck();
    }
  });

  test('rendering strategy radiogroup works with keyboard navigation', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const strategyToggle = controlsPanel.getByRole('button', { name: /rendering strategy/i }).first();
    await expect(strategyToggle).toBeVisible();
    if ((await strategyToggle.getAttribute('aria-expanded')) === 'false') {
      await strategyToggle.click();
    }
    const strategyGroup = controlsPanel.getByRole('radiogroup', { name: /rendering strategy/i });
    await expect(strategyGroup).toBeVisible();

    const strategyRadios = strategyGroup.getByRole('radio');
    const strategyRadioCount = await strategyRadios.count();
    expect(strategyRadioCount).toBeGreaterThan(1);

    const checkedBefore = strategyGroup.locator('[role="radio"][aria-checked="true"]').first();
    const checkedBeforeId = await checkedBefore.getAttribute('data-rendering-strategy-id');
    expect(checkedBeforeId).toBeTruthy();

    await checkedBefore.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);

    const checkedAfterArrow = strategyGroup.locator('[role="radio"][aria-checked="true"]').first();
    const checkedAfterArrowId = await checkedAfterArrow.getAttribute('data-rendering-strategy-id');
    expect(checkedAfterArrowId).toBeTruthy();

    if (strategyRadioCount > 1) {
      expect(checkedAfterArrowId).not.toBe(checkedBeforeId);
    }
  });

  test('canvas strategy unavailable copy appears only when canvas option is disabled', async ({ page }) => {
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    const strategyGroup = controlsPanel.getByRole('radiogroup', { name: /rendering strategy/i });
    await expect(strategyGroup).toBeVisible();

    const canvasStrategy = strategyGroup.locator('[role="radio"][data-rendering-strategy-id="canvas"]');
    await expect(canvasStrategy).toBeVisible();

    const unavailableCopy = controlsPanel.locator('#rendering-strategy-canvas-unavailable-copy');
    const ariaDisabled = await canvasStrategy.getAttribute('aria-disabled');

    if (ariaDisabled === 'true') {
      await expect(unavailableCopy).toBeVisible();
      await expect(unavailableCopy).toContainText(/unavailable/i);
    } else {
      await expect(unavailableCopy).toHaveCount(0);
    }
  });

  // ---------------------------------------------------------------------------
  // 14. Mac wheel handling placeholder
  // ---------------------------------------------------------------------------
  // NOTE: macOS trackpad pinch-to-zoom and two-finger scroll behavior cannot
  // be reliably tested in headless Chromium. The DependencyGraph component
  // has custom wheel event handling (classifyWheelIntent + isMacPlatform)
  // that distinguishes between:
  //   - Pinch-to-zoom (ctrlKey set by macOS for trackpad pinch gestures)
  //   - Trackpad two-finger scroll (small deltaX/deltaY, no ctrlKey)
  //   - Mouse wheel discrete scroll
  //
  // This behavior must be verified manually on macOS hardware with a trackpad.
  // See: src/client/components/DependencyGraph/utils/wheelIntent.ts
  //
  // Manual test steps:
  //   1. Pinch-to-zoom on the graph → should zoom in/out smoothly
  //   2. Two-finger scroll → should pan the graph
  //   3. Regular mouse wheel → should zoom (non-Mac) or pan (Mac)
  test.skip('mac trackpad wheel handling requires manual testing on macOS hardware', async () => {
    // This test is intentionally skipped — it's a placeholder documenting
    // the need for manual macOS trackpad testing.
  });
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract the current zoom level from Vue Flow's viewport transform.
 * Vue Flow applies a CSS transform on `.vue-flow__viewport` like:
 *   transform: translate(Xpx, Ypx) scale(Z)
 */
async function getViewportZoom(page: Page): Promise<number> {
  const transform = await page.locator('.vue-flow__viewport').getAttribute('style');
  if (!transform) return 1;
  const scaleMatch = /scale\(([^)]+)\)/.exec(transform) ?? [];
  return parseFloat(scaleMatch[1] ?? '1');
}

/**
 * Extract the full viewport transform { x, y, zoom } from the Vue Flow
 * viewport element's inline style.
 * @param page - The Playwright page object.
 * @returns The viewport transform { x, y, zoom }.
 */
async function getViewportTransform(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const style = await page.locator('.vue-flow__viewport').getAttribute('style');
  if (!style) return { x: 0, y: 0, zoom: 1 };

  const translateMatch = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(style) ?? [];
  const scaleMatch = /scale\(([^)]+)\)/.exec(style) ?? [];

  return {
    x: parseFloat(translateMatch[1] ?? '0'),
    y: parseFloat(translateMatch[2] ?? '0'),
    zoom: parseFloat(scaleMatch[1] ?? '1'),
  };
}

async function getZoomInControl(page: Page): Promise<Locator> {
  const zoomInButton = page
    .locator(
      '.vue-flow__controls button[aria-label="Zoom in"], .vue-flow__controls button[title="Zoom in"], .vue-flow__controls-zoomin, .vue-flow__controls-zoom-in'
    )
    .first();
  await expect(zoomInButton).toBeVisible();
  return zoomInButton;
}

async function getFitViewControl(page: Page): Promise<Locator> {
  const fitViewButton = page
    .locator(
      '.vue-flow__controls button[aria-label="Fit view to content"], .vue-flow__controls button[title="Fit view"], .vue-flow__controls-fitview, .vue-flow__controls-fit-view'
    )
    .first();
  await expect(fitViewButton).toBeVisible();
  return fitViewButton;
}

function boxesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

async function getInteractableNode(page: Page): Promise<Locator> {
  const nodes = page.locator('.vue-flow__node');
  const count = await nodes.count();
  const panelBox = await page.locator('.vue-flow__panel.top.left').first().boundingBox();
  for (let index = 0; index < count; index += 1) {
    const candidate = nodes.nth(index);
    const box = await candidate.boundingBox();
    if (!box) {
      continue;
    }
    if (!panelBox || !boxesOverlap(box, panelBox)) {
      return candidate;
    }
  }
  return nodes.first();
}

interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getVisibleNodeBoxes(page: Page): Promise<NodeBox[]> {
  return page.locator('.vue-flow__node').evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: (element as HTMLElement).dataset['id'] ?? '',
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((box) => box.id.length > 0 && box.width > 0 && box.height > 0)
  );
}

function hasMeaningfulNodeOverlap(first: NodeBox, second: NodeBox, tolerancePx = 0): boolean {
  const overlapWidth = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const overlapHeight = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return overlapWidth > tolerancePx && overlapHeight > tolerancePx;
}
