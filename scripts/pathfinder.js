// Minimal binary min-heap keyed on node.f, so we avoid re-sorting/scanning
// the entire open set on every iteration.
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this._bubbleUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._bubbleDown(0);
    }
    return top;
  }

  _bubbleUp(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].f <= this.items[index].f) break;
      [this.items[parent], this.items[index]] = [
        this.items[index],
        this.items[parent]
      ];
      index = parent;
    }
  }

  _bubbleDown(index) {
    const n = this.items.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      if (left < n && this.items[left].f < this.items[smallest].f)
        smallest = left;
      if (right < n && this.items[right].f < this.items[smallest].f)
        smallest = right;
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [
        this.items[index],
        this.items[smallest]
      ];
      index = smallest;
    }
  }
}

export class KinematicPathfinder {
  constructor(turningRadiusGridUnits = 1) {
    this.turningRadiusGridUnits = Math.max(0.1, turningRadiusGridUnits);
  }

  // requireCardinalApproach: when true (default), the path must arrive at the
  // destination with a heading within 22.5° of a cardinal direction (N/E/S/W).
  // This prevents straight diagonal lines — the token must arc to align with the
  // grid before reaching the square.  Pass false to allow any arrival heading
  // (used as a fallback when a cardinal approach is physically blocked).
  findPath(start, end, initialRotation, requireCardinalApproach = true) {
    const gridSize = canvas.grid.size;
    const turningRadiusPixels = this.turningRadiusGridUnits * gridSize;

    const stepDistancePixels = gridSize / 2;

    const maxAllowedRad = stepDistancePixels / turningRadiusPixels;
    const maxAllowedDeg = maxAllowedRad * (180 / Math.PI);

    // Fixed-ish angular spacing between turn options, independent of radius, so
    // tight radii (large maxAllowedDeg) don't end up with only 5 coarse jumps.
    // Capped so branching factor - and therefore search cost - stays bounded.
    const angularResolutionDeg = 3;
    const rawSteps = Math.round(maxAllowedDeg / angularResolutionDeg);
    const numSteps = Math.min(10, Math.max(1, rawSteps));
    const turnIncrements = [];
    for (let i = -numSteps; i <= numSteps; i++) {
      turnIncrements.push((i / numSteps) * maxAllowedDeg);
    }

    const normalizedStartHeading = ((initialRotation % 360) + 360) % 360;
    const goalToleranceSq = (stepDistancePixels * 0.6) ** 2;

    // Bucket sizing must scale with the actual angular resolution of this
    // radius's turn options - a fixed bucket collapses distinct turn amounts
    // into the same state once maxAllowedDeg gets small (wide radii), which
    // silently erases the radius restriction for anything but tight turns.
    const smallestGapDeg = 0.5 * maxAllowedDeg; // gap between adjacent turnIncrements
    const stepIncrementDeg = maxAllowedDeg / numSteps;
    const headingBucketDeg = Math.max(0.5, stepIncrementDeg * 0.4);
    const positionBucketPixels = Math.max(2, stepDistancePixels / 2);

    const stateKey = (x, y, heading) => {
      const bx = Math.round(x / positionBucketPixels);
      const by = Math.round(y / positionBucketPixels);
      const bh =
        (Math.round(heading / headingBucketDeg) * headingBucketDeg) % 360;
      return `${bx}_${by}_${bh}`;
    };

    const startDist = Math.hypot(end.x - start.x, end.y - start.y);
    const startGoalAngleDeg =
      ((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI + 360) %
      360;
    let startAngDiff =
      Math.abs(normalizedStartHeading - startGoalAngleDeg) % 360;
    if (startAngDiff > 180) startAngDiff = 360 - startAngDiff;
    const startEstTurnArc =
      ((startAngDiff * Math.PI) / 180) * turningRadiusPixels;
    const startNode = {
      x: start.x,
      y: start.y,
      heading: normalizedStartHeading,
      g: 0,
      h: startDist + startEstTurnArc * 0.4,
      parent: null
    };
    startNode.f = startNode.g + startNode.h;

    const open = new MinHeap();
    open.push(startNode);

    const bestG = new Map();
    bestG.set(stateKey(startNode.x, startNode.y, startNode.heading), 0);
    const closed = new Set();

    const activeWalls = Array.from(canvas.walls.placeables || []);

    const maxIterations = 8000;
    const maxNodesTracked = 50000;
    let iterations = 0;

    while (open.size > 0) {
      if (++iterations > maxIterations) return null;
      if (bestG.size > maxNodesTracked) return null;

      const current = open.pop();
      const currentKey = stateKey(current.x, current.y, current.heading);

      if (closed.has(currentKey)) continue;
      if (current.g > (bestG.get(currentKey) ?? Infinity)) continue;

      const dx = end.x - current.x;
      const dy = end.y - current.y;
      if (dx * dx + dy * dy <= goalToleranceSq) {
        // Require a cardinal approach heading (within 22.5° of N/E/S/W) so that
        // the token arcs into the destination square rather than arriving on a
        // straight diagonal line.
        const mod90 = current.heading % 90;
        const isCardinalApproach = mod90 <= 22.5 || mod90 >= 67.5;
        if (!requireCardinalApproach || isCardinalApproach) {
          // Snap the final node in-place to the exact goal square centre so the
          // token always "lines up" with the grid cell.  We mutate current.x/y
          // here rather than chaining a new node — chaining produced a
          // near-duplicate waypoint pair that caused Foundry to emit undefined
          // entries in its path result (TypeError in arePositionsEqual).
          current.x = end.x;
          current.y = end.y;
          return this.reconstructPath(current);
        }
      }

      closed.add(currentKey);

      for (const turn of turnIncrements) {
        const nextHeading = (((current.heading + turn) % 360) + 360) % 360;
        const rad = nextHeading * (Math.PI / 180);
        const nextX = current.x + Math.cos(rad) * stepDistancePixels;
        const nextY = current.y + Math.sin(rad) * stepDistancePixels;
        const nextKey = stateKey(nextX, nextY, nextHeading);

        if (closed.has(nextKey)) continue;

        let hasWallCollision = false;
        for (const wall of activeWalls) {
          if (wall.document?.move === 0) continue;
          const wData = wall.document || wall;
          if (
            this.lineSegmentsIntersect(
              current.x,
              current.y,
              nextX,
              nextY,
              wData.c[0],
              wData.c[1],
              wData.c[2],
              wData.c[3]
            )
          ) {
            hasWallCollision = true;
            break;
          }
        }
        if (hasWallCollision) continue;

        const g = current.g + stepDistancePixels;
        if (g >= (bestG.get(nextKey) ?? Infinity)) continue;

        bestG.set(nextKey, g);

        // Improved heuristic: Euclidean distance + estimated arc cost to align
        // with the goal direction.  This makes A* prefer nodes that are already
        // facing the goal, which strongly discourages winding diagonal detours.
        const dist = Math.hypot(end.x - nextX, end.y - nextY);
        const goalAngleDeg =
          ((Math.atan2(end.y - nextY, end.x - nextX) * 180) / Math.PI + 360) %
          360;
        let angDiff = Math.abs(nextHeading - goalAngleDeg) % 360;
        if (angDiff > 180) angDiff = 360 - angDiff;
        // Arc length to turn from current heading to face the goal
        const estTurnArc = ((angDiff * Math.PI) / 180) * turningRadiusPixels;
        const h = dist + estTurnArc * 0.4;

        const neighbor = {
          x: nextX,
          y: nextY,
          heading: nextHeading,
          g,
          h,
          parent: current
        };
        neighbor.f = neighbor.g + neighbor.h;
        open.push(neighbor);
      }
    }
    return null;
  }

  lineSegmentsIntersect(p0_x, p0_y, p1_x, p1_y, p2_x, p2_y, p3_x, p3_y) {
    let s1_x = p1_x - p0_x;
    let s1_y = p1_y - p0_y;
    let s2_x = p3_x - p2_x;
    let s2_y = p3_y - p2_y;

    let s =
      (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) /
      (-s2_x * s1_y + s1_x * s2_y);
    let t =
      (s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) /
      (-s2_x * s1_y + s1_x * s2_y);

    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  }

  reconstructPath(node) {
    const path = [];
    let curr = node;
    while (curr !== null) {
      path.unshift({ x: curr.x, y: curr.y, heading: curr.heading });
      curr = curr.parent;
    }
    return path;
  }
}
