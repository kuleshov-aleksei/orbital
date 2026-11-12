# Spatial Worlds

A spatial room shows a 2D world rendered with PixiJS. Participants walk around as animated characters (with directional walk and idle animations), and voice volume drops with distance: people outside earshot are muted. A boombox placed in the world plays music to people nearby.

Worlds are tile maps built in **Godot 4** and exported by the script in [`tools/godot-export/export_world.gd`](../tools/godot-export/export_world.gd). Each room can have its own world.

## Rendering layers

Layers render in this order: background → background-decorations → ground (where characters walk) → ground-decorations → decoration → sky.

Each `TileMapLayer` can use its own `TileSet`, and one layer can mix tiles from several tilesets. The exporter gives each unique `(TileSet, source_id)` pair a global source ID and exports its texture separately. Every tile in `world.json` carries its `sourceId`.

## 1. Set up the Godot scene

Create a `TileMapLayer` node for each layer. The node name decides how the layer is handled:

| Layer name | Render pass | Description |
|---|---|---|
| `background` | Below characters | Water, space, sky: rendered first |
| `background-decorations` | Below characters | Animated foam, water edges: above background, below ground |
| `ground` | Below characters | Floor tiles, paths |
| `ground-decorations` | Below characters | Flowers, rocks, puddles: above ground |
| `collision` | Invisible | Tiles that block movement |
| `decorations` | Above characters | Treetops, signs, lamps |
| `elevation` | Above characters | Elevation cliffs |
| `sky` | Above everything | Clouds and other sky elements |
| `objects` | n/a | `Marker2D` children for placed props |

**TileSet custom data layers** (define them on the tiles in your TileSet):
- `collidable` (bool): the tile blocks movement. Used when no collision polygons are drawn.
- `animated` (bool): the tile cycles through animation frames.

**Collision polygons**: draw collision shapes on tiles in the TileSet's **Physics Layer 0**. The exporter picks them up and marks the tile collidable.

**Animation**: frames are a horizontal strip in the atlas. The exporter reads the frame count and frame duration from Godot. Set the atlas source's animation mode to `ANIMATION_MODE_RANDOM_START_TIMES` (value `1`) to make neighboring tiles start on random frames instead of in sync.

**Markers**:
- `SpawnPoint` (`Marker2D`): where players appear. Defaults to the center of the world.
- `Boombox` (`Marker2D`): where the boombox stands. Defaults to `(0, -200)`.

**Object metadata** (on `Marker2D` children of the `objects` layer):
- `tile_id` (int): the tileset tile this object uses;
- `animated` (bool): enable frame animation;
- `collision_w` / `collision_h` (int): hitbox size.

## 2. Export

The exporter is a Godot `EditorScript`. With the scene open, open `export_world.gd` in Godot's script editor and run it (**File → Run**, `Ctrl+Shift+X`), then pick the output folder. The separate `orbital-spatial-maps` Godot project links it as an addon and also has `cli_export.gd` for exporting a scene set in the `cli_export/scene` project setting.

The export produces:
- `world.json`: tile grid, per-tile source IDs, collision polygons, animation data, objects, spawn point and boombox position;
- `tileset_0.png`, `tileset_1.png`, …: one texture per tileset source.

## 3. Add the assets

Put the files in `frontend/public/assets/worlds/<world_id>/`:

```
frontend/public/assets/worlds/
├── monaco/
│   ├── world.json
│   └── tileset_0.png
└── default/
    └── world.json       # empty fallback, ships with the app
```

## 4. Assign the world to a room

When creating or editing a spatial room, set its `world` field to the world ID (the directory name). The frontend loads `assets/worlds/<world_id>/world.json`. Rooms without a world use `default`: an open space with a boombox and no tiles.

## Collision system

Movement uses SAT (Separating Axis Theorem) collision against convex polygons:

- **Per-tile collision**: every tile has a `collidable` flag and optional `collisionPolygons` (`[number, number][][]`). Tiles on any layer can collide.
- **Polygon export**: Godot stores polygon points relative to the tile center. The exporter shifts them by half a tile to make them top-left-relative.
- **Decomposition**: non-rectangular polygons (for example L-shaped tiles) are cut into axis-aligned rectangles with Y scanlines before collision tests.
- **Resolution**: X and Y are resolved separately, so you slide along walls. A final minimum-translation pass (up to 2 iterations) fixes remaining overlap.
- **Fallback**: tiles without polygons but with `collidable = true` block the whole tile.
- **Debug overlay**: press `C` in a spatial room to show collision polygons (red) and your hitbox (green).
