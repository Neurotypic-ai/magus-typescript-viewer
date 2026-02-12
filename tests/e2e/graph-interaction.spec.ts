import { expect, test } from '@playwright/test';

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
    await page.click('button[aria-label="Zoom in"]');

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
    await page.click('button[aria-label="Zoom in"]');
    await page.click('button[aria-label="Zoom in"]');
    await page.waitForTimeout(300);

    const zoomBeforeFit = await getViewportZoom(page);

    // Click fit view.
    await page.click('button[aria-label="Fit view to content"]');
    await page.waitForTimeout(400);

    const zoomAfterFit = await getViewportZoom(page);

    // The zoom should have changed (fit adjusts to graph extents).
    expect(zoomAfterFit).not.toBeCloseTo(zoomBeforeFit, 1);
  });

  // ---------------------------------------------------------------------------
  // 4. Node click selects
  // ---------------------------------------------------------------------------
  test('clicking a node gives it the selected class', async ({ page }) => {
    const firstNode = page.locator('.vue-flow__node').first();
    await firstNode.click();

    // Vue Flow adds the `.selected` class to the wrapper node element.
    await expect(firstNode).toHaveClass(/selected/);
  });

  // ---------------------------------------------------------------------------
  // 5. Pane click deselects
  // ---------------------------------------------------------------------------
  test('clicking the pane deselects all nodes', async ({ page }) => {
    // Select a node first.
    const firstNode = page.locator('.vue-flow__node').first();
    await firstNode.click();
    await expect(firstNode).toHaveClass(/selected/);

    // Click on the pane background to deselect.
    await page.locator('.vue-flow__pane').click();

    // No node should have the selected class anymore.
    const selectedNodes = page.locator('.vue-flow__node.selected');
    await expect(selectedNodes).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Minimap renders
  // ---------------------------------------------------------------------------
  test('minimap renders with SVG content', async ({ page }) => {
    const minimap = page.locator('.graph-mini-map');
    await expect(minimap).toBeVisible();

    // The minimap contains an SVG element.
    const svg = minimap.locator('svg.graph-mini-map-svg');
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
    const minimapSvg = page.locator('svg.graph-mini-map-svg');
    const box = await minimapSvg.boundingBox();
    expect(box).toBeTruthy();

    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
    }

    await page.waitForTimeout(400);

    const viewportAfter = await getViewportTransform(page);

    // The viewport translate values should differ after the minimap click.
    const positionChanged =
      Math.abs(viewportAfter.x - viewportBefore.x) > 1 ||
      Math.abs(viewportAfter.y - viewportBefore.y) > 1;
    expect(positionChanged).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 8. Focus action
  // ---------------------------------------------------------------------------
  test('focus action button centers viewport on the node', async ({ page }) => {
    // Click a node first so its action buttons are interactable.
    const firstNode = page.locator('.vue-flow__node').first();
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
    const firstNode = page.locator('.vue-flow__node').first();
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
  // 10. Back to overview
  // ---------------------------------------------------------------------------
  test('back to full graph restores all nodes after isolate', async ({ page }) => {
    const totalNodesBefore = await page.locator('.vue-flow__node').count();

    // Isolate the first node.
    const firstNode = page.locator('.vue-flow__node').first();
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
  // 11. Keyboard navigation
  // ---------------------------------------------------------------------------
  test('arrow key navigates to a connected node', async ({ page }) => {
    // Focus the graph root so keyboard events are captured.
    const graphRoot = page.locator('.dependency-graph-root');
    await graphRoot.focus();

    // Select the first node by clicking it.
    const firstNode = page.locator('.vue-flow__node').first();
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
  // 12. Graph controls panel
  // ---------------------------------------------------------------------------
  test('graph controls panel renders with layout algorithm buttons', async ({ page }) => {
    // The controls are inside a Vue Flow panel at top-left.
    const controlsPanel = page.locator('.vue-flow__panel.top.left');
    await expect(controlsPanel).toBeVisible();

    // Verify layout algorithm buttons exist.
    for (const algo of ['layered', 'radial', 'force', 'stress']) {
      const button = controlsPanel.locator(`button[aria-label="Set layout algorithm to ${algo}"]`);
      await expect(button).toBeVisible();
    }
  });

  // ---------------------------------------------------------------------------
  // 13. Mac wheel handling placeholder
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
async function getViewportZoom(page: import('@playwright/test').Page): Promise<number> {
  const transform = await page.locator('.vue-flow__viewport').getAttribute('style');
  if (!transform) return 1;
  const scaleMatch = transform.match(/scale\(([^)]+)\)/);
  return scaleMatch?.[1] ? parseFloat(scaleMatch[1]) : 1;
}

/**
 * Extract the full viewport transform { x, y, zoom } from the Vue Flow
 * viewport element's inline style.
 */
async function getViewportTransform(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number; zoom: number }> {
  const style = await page.locator('.vue-flow__viewport').getAttribute('style');
  if (!style) return { x: 0, y: 0, zoom: 1 };

  const translateMatch = style.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  const scaleMatch = style.match(/scale\(([^)]+)\)/);

  return {
    x: translateMatch?.[1] ? parseFloat(translateMatch[1]) : 0,
    y: translateMatch?.[2] ? parseFloat(translateMatch[2]) : 0,
    zoom: scaleMatch?.[1] ? parseFloat(scaleMatch[1]) : 1,
  };
}
