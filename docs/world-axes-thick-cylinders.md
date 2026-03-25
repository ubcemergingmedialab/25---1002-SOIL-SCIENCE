# Thick world axes (debug overlay)

## What changed

The debug world axes in `ThreeApp` (drawn in `renderDebug()` after the Gaussian splat scene) used to be `THREE.AxesHelper`. They are now built as **three colored cylinders** via `createThickWorldAxes()` in `src/three/ThreeApp.ts`.

## Rationale

`AxesHelper` renders **line segments** with `LineBasicMaterial`. In WebGL, **line width is largely unsupported** on common desktop browsers (the `linewidth` property is ignored), so axes stay hair-thin and are hard to see in **screenshots** and presentations.

**Mesh cylinders** render at a real geometric thickness regardless of GPU line limitations, so red (X), green (Y), and blue (Z) stay clearly visible. The colors match the usual Three.js axis convention.

## Tuning

In `initScene()`, adjust:

```ts
this.worldAxes = createThickWorldAxes(1, 0.045);
```

- First argument: axis length in world units (same idea as `AxesHelper(size)`).
- Second argument: cylinder radius; increase for chunkier axes in captures.
