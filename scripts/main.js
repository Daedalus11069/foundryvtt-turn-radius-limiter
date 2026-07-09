import { KinematicPathfinder } from "./pathfinder.js";

const MODULE_ID = "turn-radius-limiter";
const FLAG_KEY = "turningRadius";
const FLAG_ENABLED_KEY = "enabled";
const SETTING_DEFAULT_KEY = "defaultTurningRadiusGridUnits";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Core Configurations for v13.`);

  game.settings.register(MODULE_ID, SETTING_DEFAULT_KEY, {
    name: "Default Turning Radius (Grid Units)",
    hint: "The global fallback minimum turning circle radius measured in grid cells.",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      1: "1 Cell (Tight / Standard)",
      2: "2 Cells (Medium Vehicle)",
      3: "3 Cells (Wide Circle / Large Mount)",
      5: "5 Cells (Extremely Wide Berth)"
    },
    default: 1
  });
});

Hooks.once("setup", () => {
  console.log(`${MODULE_ID} | Hooking Token Pathfinding via libWrapper.`);

  // Token#findMovementPath is Foundry's documented pathfinding override point.
  // (Token#measureMovementPath only computes cost/distance for a path that's
  // already been decided elsewhere - it never actually steers the token.)
  libWrapper.register(
    MODULE_ID,
    "foundry.canvas.placeables.Token.prototype.findMovementPath",
    function (wrapped, waypoints, options = {}) {
      // If there aren't enough points to establish a vector, use core logic
      if (!waypoints || waypoints.length < 2)
        return wrapped(waypoints, options);
      if (!this.actor) return wrapped(waypoints, options);

      // Per-token opt-in: if the enabled flag is falsy (default), skip this module.
      if (!this.actor.getFlag(MODULE_ID, FLAG_ENABLED_KEY))
        return wrapped(waypoints, options);

      // Collect turning circle radius constraint: Actor Flag -> Global Setting fallback -> Default 1
      const globalDefault =
        game.settings.get(MODULE_ID, SETTING_DEFAULT_KEY) ?? 1;
      const turningRadiusGridUnits =
        this.actor.getFlag(MODULE_ID, FLAG_KEY) ?? globalDefault;

      // Foundry's rotation: 0deg = South, clockwise (0/90/180/270 = S/W/N/E).
      // Our pathfinder's internal angle: 0deg = East, clockwise (0/90/180/270 = E/S/W/N).
      // These are offset by 90deg - convert on the way in so the pathfinder's
      // idea of "which way is this token already facing" actually matches reality.
      const initialRotation = ((this.document.rotation ?? 0) + 90) % 360;
      const pathfinder = new KinematicPathfinder(turningRadiusGridUnits);

      let completeKinematicPath = [];
      let pathfindingFailed = false;

      // Traverse the points array to reconstruct path elements matching the turning arc boundaries
      for (let i = 0; i < waypoints.length - 1; i++) {
        const start = waypoints[i];
        const end = waypoints[i + 1];

        const currentRotation =
          i === 0
            ? initialRotation
            : (completeKinematicPath[completeKinematicPath.length - 1]
                ?.heading ?? initialRotation);

        // First try to arrive at a cardinal heading (prevents straight diagonal
        // lines).  If that yields no path (e.g. walls block a cardinal approach)
        // fall back to accepting any compass heading so the token can still move.
        const segmentPath =
          pathfinder.findPath(start, end, currentRotation, true) ??
          pathfinder.findPath(start, end, currentRotation, false);

        if (segmentPath) {
          if (completeKinematicPath.length > 0) segmentPath.shift();
          completeKinematicPath.push(...segmentPath);
        } else {
          // Fail-safe fallback: if the pathfinder gets cornered or blocked,
          // defer entirely to core's own pathfinding for this call.
          pathfindingFailed = true;
          break;
        }
      }

      if (pathfindingFailed || completeKinematicPath.length === 0) {
        return wrapped(waypoints, options);
      }

      // Our kinematic nodes only carry {x, y, heading}. Re-attach whatever
      // metadata (elevation, movement action, terrain, etc.) core expects on
      // each waypoint so nothing gets silently dropped along the way.
      const firstSource = waypoints[0];
      const lastSource = waypoints[waypoints.length - 1];
      const rebuiltWaypoints = completeKinematicPath.map((point, idx) => {
        const isLast = idx === completeKinematicPath.length - 1;
        const base = isLast ? lastSource : firstSource;
        return { ...base, x: point.x, y: point.y };
      });

      // Hand our dense, curve-constrained waypoints to core's real
      // findMovementPath so it builds a properly-shaped result/job from them.
      return wrapped(rebuiltWaypoints, options);
    },
    "MIXED"
  );
});
