# Turn Radius Limiter

A Foundry VTT module (v13+) that constrains token movement to respect a minimum turning radius, simulating vehicles, mounts, or any creature that cannot pivot on the spot. When enabled on a token, dragging it to a destination produces a curved arc path rather than a straight diagonal line.

## Installation

To install this module in Foundry VTT, use the following manifest URL in the "Install Module" dialog:

https://github.com/daedalus11069/foundryvtt-turn-radius-limiter/releases/latest/download/module.json

## Requirements

- Foundry VTT v13 or higher
- [libWrapper](https://foundryvtt.com/packages/lib-wrapper)

## How It Works

The module hooks into `Token#findMovementPath` via libWrapper. For each movement, a kinematic A\* pathfinder computes the shortest arc-constrained path from the token's current position and facing direction to the destination square. The path is required to arrive at the destination from a cardinal direction (North, East, South, or West) to prevent straight diagonal lines from being produced. If a cardinal approach is blocked by walls, the pathfinder relaxes that constraint and accepts any compass heading. If no path can be found at all, movement falls back to Foundry's default pathfinding.

The token's current rotation is used as the starting heading. The search explores arc steps of half a grid cell at a time, turning by up to the maximum angle permitted by the turning radius at each step.

## World Settings

One world-level setting is available under **Configure Settings > Module Settings**:

**Default Turning Radius (Grid Units)**
The fallback turning radius used for any enabled token that does not have a per-actor override. Options: 1, 2, 3, or 5 grid cells. Defaults to 1 (tight/standard).

## Per-Token Setup

The effect is disabled by default on every token. Both the enabled state and the turning radius are stored as actor flags and must be set via macro or the browser console.

### Enable the effect on a token

Open a macro or the browser console (F12) and run:

```js
// Replace `actor` with a reference to the actor, e.g. game.actors.getName("My Vehicle")
actor.setFlag("turn-radius-limiter", "enabled", true);
```

### Disable the effect on a token

```js
actor.unsetFlag("turn-radius-limiter", "enabled");
```

### Set a per-actor turning radius override

```js
// Value is in grid units (grid cells). Overrides the world default for this actor only.
actor.setFlag("turn-radius-limiter", "turningRadius", 3);
```

### Remove the per-actor radius override (revert to world default)

```js
actor.unsetFlag("turn-radius-limiter", "turningRadius");
```

### Bulk-enable via macro

```js
// Enable on all tokens currently on the active scene
for (const token of canvas.tokens.placeables) {
  if (token.actor) token.actor.setFlag("turn-radius-limiter", "enabled", true);
}
```

## Flag Reference

All flags live on the **Actor** (not the Token Document).

| Flag key        | Type    | Default | Description                                                                              |
| --------------- | ------- | ------- | ---------------------------------------------------------------------------------------- |
| `enabled`       | Boolean | `false` | Whether the turning radius constraint is active for this actor.                          |
| `turningRadius` | Number  | (world) | Minimum turning circle radius in grid units. Falls back to the world setting if not set. |

## Turning Radius Guide

The turning radius is the radius of the tightest circle the token can follow without reversing. A value of 1 means the token can complete a full circle that fits inside a 2x2 area of grid cells.

| Radius | Suitable for                               |
| ------ | ------------------------------------------ |
| 1      | Riding horses, motorcycles, tight vehicles |
| 2      | Cars, small wagons, medium mounts          |
| 3      | Trucks, large wagons, large mounts         |
| 5      | Ships, aircraft, very large creatures      |

## Fallback Behaviour

If the kinematic pathfinder cannot find a valid arc path within its search budget (8,000 iterations), movement falls back silently to Foundry's default pathfinding for that drag. This prevents tokens from ever being stuck. The fallback is most likely to trigger in heavily walled areas where the only viable route requires many tight turns.

## Compatibility Notes

- Tokens without an associated actor are not affected and always use default pathfinding.
- Tokens whose `enabled` flag is not set (the default) are completely unaffected; no pathfinding cost is incurred.
- The module is compatible with elevation and terrain metadata — those properties are preserved on all waypoints passed back to core.
