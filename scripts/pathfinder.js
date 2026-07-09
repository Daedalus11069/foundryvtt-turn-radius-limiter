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

  findPath(start, end, initialRotation) {
    const gridSize = canvas.grid.size;
    const turningRadiusPixels = this.turningRadiusGridUnits * gridSize;

    const stepDistancePixels = gridSize / 2;

    const maxAllowedRad = stepDistancePixels / turningRadiusPixels;
    const maxAllowedDeg = maxAllowedRad * (180 / Math.PI);

    const turnIncrements = [-1, -0.5, 0, 0.5, 1].map(f => f * maxAllowedDeg);

    const normalizedStartHeading = ((initialRotation % 360) + 360) % 360;
    const goalToleranceSq = (stepDistancePixels * 0.6) ** 2;

    // Bucket sizing must scale with the actual angular resolution of this
    // radius's turn options - a fixed bucket collapses distinct turn amounts
    // into the same state once maxAllowedDeg gets small (wide radii), which
    // silently erases the radius restriction for anything but tight turns.
    const smallestGapDeg = 0.5 * maxAllowedDeg; // gap between adjacent turnIncrements
    const headingBucketDeg = Math.max(0.5, smallestGapDeg * 0.4);
    const positionBucketPixels = Math.max(2, stepDistancePixels / 2);

    const stateKey = (x, y, heading) => {
      const bx = Math.round(x / positionBucketPixels);
      const by = Math.round(y / positionBucketPixels);
      const bh =
        (Math.round(heading / headingBucketDeg) * headingBucketDeg) % 360;
      return `${bx}_${by}_${bh}`;
    };

    const startNode = {
      x: start.x,
      y: start.y,
      heading: normalizedStartHeading,
      g: 0,
      h: Math.hypot(end.x - start.x, end.y - start.y),
      parent: null
    };
    startNode.f = startNode.g + startNode.h;

    const open = new MinHeap();
    open.push(startNode);

    const bestG = new Map();
    bestG.set(stateKey(startNode.x, startNode.y, startNode.heading), 0);
    const closed = new Set();

    const activeWalls = Array.from(canvas.walls.placeables || []);

    const maxIterations = 3000;
    const maxNodesTracked = 20000;
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
        return this.reconstructPath(current);
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
        const neighbor = {
          x: nextX,
          y: nextY,
          heading: nextHeading,
          g,
          h: Math.hypot(end.x - nextX, end.y - nextY),
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
