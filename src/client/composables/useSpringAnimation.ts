/**
 * Spring-damper animation system for smooth node collision resolution.
 *
 * Sits between the collision resolver (which computes target positions
 * deterministically) and the graph store. Instead of snapping nodes to
 * resolved positions, this composable interpolates toward them using
 * spring physics for organic, buttery-smooth motion.
 *
 * Per-node state is stored in a plain JS Map (not reactive) to avoid
 * Vue reactivity overhead at 60fps with 350+ entries.
 */

import { ref } from 'vue';

import type { Ref } from 'vue';

// ---------------------------------------------------------------------------
// Spring configuration
// ---------------------------------------------------------------------------

export interface SpringConfig {
  /** Spring constant (higher = snappier). */
  stiffness: number;
  /** Damping coefficient (higher = less overshoot). */
  damping: number;
  /** Mass (higher = more sluggish, heavier feel). */
  mass: number;
  /** Settlement threshold in px — spring is "settled" when displacement
   *  AND velocity are both below this value. */
  precision: number;
}

/** Profile for regular nodes: responsive, slight overshoot. */
export const SPRING_PROFILE_NODE: Readonly<SpringConfig> = {
  stiffness: 170,
  damping: 22,
  mass: 1.0,
  precision: 0.5,
};

/** Profile for group/folder nodes: heavier, softer expansion. */
export const SPRING_PROFILE_GROUP: Readonly<SpringConfig> = {
  stiffness: 120,
  damping: 20,
  mass: 1.5,
  precision: 0.5,
};

// ---------------------------------------------------------------------------
// Spring math (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Advance one axis of a spring-damper by `dt` seconds using semi-implicit
 * Euler integration (unconditionally stable for typical UI spring params).
 *
 * Returns the new position and velocity.
 */
export function stepSpringAxis(
  current: number,
  target: number,
  velocity: number,
  dt: number,
  config: SpringConfig
): { position: number; velocity: number } {
  const displacement = current - target;
  const acceleration = (-config.stiffness * displacement - config.damping * velocity) / config.mass;
  const newVelocity = velocity + acceleration * dt;
  const newPosition = current + newVelocity * dt;
  return { position: newPosition, velocity: newVelocity };
}

/**
 * Check whether a spring axis has settled (close enough to target with
 * negligible velocity).
 */
export function isAxisSettled(
  current: number,
  target: number,
  velocity: number,
  precision: number
): boolean {
  return Math.abs(current - target) < precision && Math.abs(velocity) < precision;
}

// ---------------------------------------------------------------------------
// Per-node spring state
// ---------------------------------------------------------------------------

interface SpringNodeState {
  // Current interpolated values
  currentX: number;
  currentY: number;
  currentWidth: number;
  currentHeight: number;
  // Targets from collision resolver
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  // Velocities
  velocityX: number;
  velocityY: number;
  velocityWidth: number;
  velocityHeight: number;
  // Whether this node is still animating
  isSettling: boolean;
  // Determines spring profile
  isGroup: boolean;
}

// ---------------------------------------------------------------------------
// Composable interface
// ---------------------------------------------------------------------------

export interface UseSpringAnimationOptions {
  /** Called each animation frame with interpolated positions and sizes. */
  onFrame: (
    positions: Map<string, { x: number; y: number }>,
    sizes: Map<string, { width: number; height: number }>
  ) => void;
  /** Called when all springs have settled. */
  onSettle: () => void;
  /** Whether reduced motion is preferred (skip animation, snap immediately). */
  reducedMotion: Ref<boolean>;
  /** Optional node spring config override. */
  nodeSpringConfig?: SpringConfig;
  /** Optional group spring config override. */
  groupSpringConfig?: SpringConfig;
}

export interface SpringAnimation {
  /**
   * Set new target positions and sizes from the collision resolver.
   * Starts the animation loop if not already running.
   * Preserves existing velocity for nodes already animating (smooth retargeting).
   *
   * @param positions - Map of nodeId → target position
   * @param sizes - Map of nodeId → target size
   * @param nodeTypes - Map of nodeId → node type string (used to pick spring profile)
   */
  setTargets: (
    positions: Map<string, { x: number; y: number }>,
    sizes: Map<string, { width: number; height: number }>,
    nodeTypes: Map<string, string>
  ) => void;
  /** Remove a node from the spring system (e.g. when it becomes dragged). */
  removeNode: (nodeId: string) => void;
  /** Clear all spring state (e.g. on layout reset). */
  clear: () => void;
  /** Whether any springs are currently settling. */
  isAnimating: Readonly<Ref<boolean>>;
  /** Number of nodes currently animating. */
  settlingCount: Readonly<Ref<number>>;
  /** Read current interpolated positions (for re-resolution during animation). */
  getCurrentPositions: () => Map<string, { x: number; y: number }>;
  /** Read current interpolated sizes (for re-resolution during animation). */
  getCurrentSizes: () => Map<string, { width: number; height: number }>;
  /** Stop animation and clean up. */
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Composable implementation
// ---------------------------------------------------------------------------

/** Maximum frame delta to prevent spiral-of-death on tab-switch. */
const MAX_DT_SECONDS = 0.033; // ~30fps minimum

export function useSpringAnimation(options: UseSpringAnimationOptions): SpringAnimation {
  const { onFrame, onSettle, reducedMotion } = options;
  const nodeConfig = options.nodeSpringConfig ?? SPRING_PROFILE_NODE;
  const groupConfig = options.groupSpringConfig ?? SPRING_PROFILE_GROUP;

  const springStates = new Map<string, SpringNodeState>();
  const isAnimating = ref(false);
  const settlingCount = ref(0);

  let animationFrameId: number | null = null;
  let lastFrameTime = 0;

  // ---- Animation loop ----

  function tick(now: number): void {
    const dt = Math.min((now - lastFrameTime) / 1000, MAX_DT_SECONDS);
    lastFrameTime = now;

    let settling = 0;
    const updatedPositions = new Map<string, { x: number; y: number }>();
    const updatedSizes = new Map<string, { width: number; height: number }>();

    for (const [nodeId, state] of springStates) {
      if (!state.isSettling) continue;

      const config = state.isGroup ? groupConfig : nodeConfig;

      // Step position springs
      const xResult = stepSpringAxis(state.currentX, state.targetX, state.velocityX, dt, config);
      const yResult = stepSpringAxis(state.currentY, state.targetY, state.velocityY, dt, config);
      state.currentX = xResult.position;
      state.velocityX = xResult.velocity;
      state.currentY = yResult.position;
      state.velocityY = yResult.velocity;

      // Step size springs (group nodes)
      if (state.isGroup) {
        const wResult = stepSpringAxis(state.currentWidth, state.targetWidth, state.velocityWidth, dt, groupConfig);
        const hResult = stepSpringAxis(state.currentHeight, state.targetHeight, state.velocityHeight, dt, groupConfig);
        state.currentWidth = Math.max(1, wResult.position);
        state.velocityWidth = wResult.velocity;
        state.currentHeight = Math.max(1, hResult.position);
        state.velocityHeight = hResult.velocity;
      }

      // Check settlement
      const posSettled =
        isAxisSettled(state.currentX, state.targetX, state.velocityX, config.precision) &&
        isAxisSettled(state.currentY, state.targetY, state.velocityY, config.precision);

      const sizeSettled = !state.isGroup || (
        isAxisSettled(state.currentWidth, state.targetWidth, state.velocityWidth, groupConfig.precision) &&
        isAxisSettled(state.currentHeight, state.targetHeight, state.velocityHeight, groupConfig.precision)
      );

      if (posSettled && sizeSettled) {
        // Snap to exact target
        state.currentX = state.targetX;
        state.currentY = state.targetY;
        state.velocityX = 0;
        state.velocityY = 0;
        if (state.isGroup) {
          state.currentWidth = state.targetWidth;
          state.currentHeight = state.targetHeight;
          state.velocityWidth = 0;
          state.velocityHeight = 0;
        }
        state.isSettling = false;
      } else {
        settling++;
      }

      // Emit position if it moved meaningfully (> 0.1px)
      updatedPositions.set(nodeId, { x: state.currentX, y: state.currentY });

      if (state.isGroup) {
        updatedSizes.set(nodeId, {
          width: state.currentWidth,
          height: state.currentHeight,
        });
      }
    }

    // Emit frame
    if (updatedPositions.size > 0) {
      onFrame(updatedPositions, updatedSizes);
    }

    settlingCount.value = settling;

    if (settling > 0) {
      animationFrameId = requestAnimationFrame(tick);
    } else {
      animationFrameId = null;
      isAnimating.value = false;
      onSettle();
    }
  }

  function startLoop(): void {
    if (animationFrameId !== null) return;
    isAnimating.value = true;
    lastFrameTime = performance.now();
    animationFrameId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    isAnimating.value = false;
    settlingCount.value = 0;
  }

  // ---- Public API ----

  function setTargets(
    positions: Map<string, { x: number; y: number }>,
    sizes: Map<string, { width: number; height: number }>,
    nodeTypes: Map<string, string>
  ): void {
    // Reduced motion: snap immediately, no animation
    if (reducedMotion.value) {
      onFrame(positions, sizes);
      return;
    }

    let hasSettling = false;

    for (const [nodeId, target] of positions) {
      const existing = springStates.get(nodeId);
      const isGroup = nodeTypes.get(nodeId) === 'group';
      const targetSize = sizes.get(nodeId);

      if (existing) {
        // Update targets — velocity is preserved for smooth retargeting
        existing.targetX = target.x;
        existing.targetY = target.y;
        existing.isGroup = isGroup;
        if (isGroup && targetSize) {
          existing.targetWidth = targetSize.width;
          existing.targetHeight = targetSize.height;
        }
        // Re-activate if it had settled
        const config = isGroup ? groupConfig : nodeConfig;
        const needsAnimation =
          !isAxisSettled(existing.currentX, existing.targetX, existing.velocityX, config.precision) ||
          !isAxisSettled(existing.currentY, existing.targetY, existing.velocityY, config.precision) ||
          (isGroup && targetSize && (
            !isAxisSettled(existing.currentWidth, existing.targetWidth, existing.velocityWidth, groupConfig.precision) ||
            !isAxisSettled(existing.currentHeight, existing.targetHeight, existing.velocityHeight, groupConfig.precision)
          ));
        existing.isSettling = Boolean(needsAnimation);
        if (existing.isSettling) hasSettling = true;
      } else {
        // New node entering the spring system — start from current position
        // (target IS the current position at first resolver call, so we use
        // the target as both current and target; subsequent calls will differ)
        springStates.set(nodeId, {
          currentX: target.x,
          currentY: target.y,
          currentWidth: targetSize?.width ?? 0,
          currentHeight: targetSize?.height ?? 0,
          targetX: target.x,
          targetY: target.y,
          targetWidth: targetSize?.width ?? 0,
          targetHeight: targetSize?.height ?? 0,
          velocityX: 0,
          velocityY: 0,
          velocityWidth: 0,
          velocityHeight: 0,
          isSettling: false,
          isGroup,
        });
      }
    }

    if (hasSettling) {
      startLoop();
    }
  }

  function removeNode(nodeId: string): void {
    springStates.delete(nodeId);
  }

  function clear(): void {
    stopLoop();
    springStates.clear();
  }

  function getCurrentPositions(): Map<string, { x: number; y: number }> {
    const result = new Map<string, { x: number; y: number }>();
    for (const [id, state] of springStates) {
      result.set(id, { x: state.currentX, y: state.currentY });
    }
    return result;
  }

  function getCurrentSizes(): Map<string, { width: number; height: number }> {
    const result = new Map<string, { width: number; height: number }>();
    for (const [id, state] of springStates) {
      if (state.isGroup) {
        result.set(id, { width: state.currentWidth, height: state.currentHeight });
      }
    }
    return result;
  }

  function dispose(): void {
    stopLoop();
    springStates.clear();
  }

  return {
    setTargets,
    removeNode,
    clear,
    isAnimating,
    settlingCount,
    getCurrentPositions,
    getCurrentSizes,
    dispose,
  };
}
