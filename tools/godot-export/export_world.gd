@tool
extends EditorScript

const EXPORT_FORMAT_VERSION = 2

func _run():
	var root = get_scene()
	if root == null:
		print("Error: No scene open!")
		return

	var tile_layers = _find_tile_layers(root)
	if tile_layers.is_empty():
		print("Error: No TileMapLayer nodes found in scene!")
		return

	var output_dir = _pick_output_dir()
	if output_dir.is_empty():
		print("Export cancelled.")
		return

	var dir = DirAccess.open("res://")
	if dir:
		if not dir.dir_exists(output_dir):
			dir.make_dir_recursive(output_dir)

	var world = _build_world(tile_layers, root, output_dir)

	var json_path = output_dir.path_join("world.json")
	var json_string = JSON.new().stringify(world, "", false, true)
	var file = FileAccess.open(json_path, FileAccess.WRITE)
	if file:
		file.store_string(json_string)
		file.close()
		print("Exported: " + json_path)
	else:
		print("Error: Could not write " + json_path)
		return

	print("Done! World exported to " + output_dir)


func _find_tile_layers(root: Node) -> Array:
	var layers = []
	for child in root.get_children():
		if child is TileMapLayer:
			layers.append(child)
		for grandchild in child.get_children():
			if grandchild is TileMapLayer:
				layers.append(grandchild)
	return layers


func _layer_type_for_name(name: String) -> String:
	match name:
		"background", "ground":
			return "ground"
		"background-decorations":
			return "background_decorations"
		"collision":
			return "collision"
		"ground-decorations":
			return "ground_decorations"
		"decorations", "elevation":
			return "decoration"
		"sky":
			return "sky"
	return ""


func _detect_layer_source_id(layer: TileMapLayer) -> int:
	var source_counts = {}
	for coords in layer.get_used_cells():
		var sid = layer.get_cell_source_id(coords)
		source_counts[sid] = source_counts.get(sid, 0) + 1

	var best_sid = 0
	var best_count = 0
	for sid in source_counts:
		if source_counts[sid] > best_count:
			best_count = source_counts[sid]
			best_sid = sid
	return best_sid


func _get_or_create_source(sources: Array, source_map: Dictionary, ts: TileSet, local_source_id: int, output_dir: String, tile_size: int) -> int:
	var ts_path = ts.resource_path
	if ts_path.is_empty():
		ts_path = str(ts.get_instance_id())
	var map_key = ts_path + ":" + str(local_source_id)

	if source_map.has(map_key):
		return source_map[map_key]

	var atlas_source = null
	for i in ts.get_source_count():
		var sid = ts.get_source_id(i)
		if sid == local_source_id:
			var src = ts.get_source(sid)
			if src is TileSetAtlasSource:
				atlas_source = src
				break

	if atlas_source == null:
		source_map[map_key] = -1
		return -1

	var global_source_id = sources.size()
	source_map[map_key] = global_source_id

	var texture = atlas_source.get_texture()
	var region_size = atlas_source.get_texture_region_size()
	var tex_filename = "tileset_%d.png" % global_source_id
	var tex_path = output_dir.path_join(tex_filename)

	var tile_columns = 1
	if texture != null:
		# Load original texture file directly to bypass Godot's import scaling
		var original_path = texture.resource_path
		var img = Image.new()
		if original_path.begins_with("res://"):
			var err = img.load(original_path)
			if err != OK:
				push_warning("Failed to load original texture: " + original_path + " (error " + str(err) + "), falling back to imported texture")
				img = texture.get_image()
			else:
				print("Loaded original texture: " + original_path + " (" + str(img.get_width()) + "x" + str(img.get_height()) + ")")
		else:
			img = texture.get_image()

		img.save_png(tex_path)
		print("Exported: " + tex_path)
		tile_columns = img.get_width() / region_size.x
	else:
		tex_filename = ""

	var tile_half = region_size.x / 2.0
	var tiles = _build_tile_defs(atlas_source, tile_columns, ts, tile_half)

	sources.append({
		"id": global_source_id,
		"tileset": tex_filename,
		"tileColumns": tile_columns,
		"tiles": tiles,
	})

	return global_source_id


func _build_tile_defs(atlas: TileSetAtlasSource, tile_columns: int, tile_set: TileSet = null, tile_half_px: float = 32.0) -> Array:
	var tiles = []
	if atlas == null:
		return tiles

	for index in atlas.get_tiles_count():
		var tile_coords = atlas.get_tile_id(index)
		var tile_id = tile_coords.y * tile_columns + tile_coords.x

		var collidable = false
		var animated = false
		var anim_frames = []
		var frame_duration = 300

		var random_offset = false
		var collision_polygons = null
		if atlas.has_tile(tile_coords):
			var tile_data = atlas.get_tile_data(tile_coords, 0)
			if tile_data != null:
				if tile_data.has_custom_data("collidable"):
					collidable = tile_data.get_custom_data("collidable") as bool
				var physics_layers = tile_set.get_physics_layers_count() if tile_set != null else 0
				if physics_layers > 0 and tile_data.has_method("get_collision_polygons_count") and tile_data.get_collision_polygons_count(0) > 0:
					collidable = true
					var all_polys = []
					for pi in tile_data.get_collision_polygons_count(0):
						var pts = tile_data.get_collision_polygon_points(0, pi)
						var local_pts = []
						for pt in pts:
							local_pts.append([pt.x + tile_half_px, pt.y + tile_half_px])
						all_polys.append(local_pts)
					collision_polygons = all_polys
			if atlas.has_method("get_tile_animation_mode"):
				var mode = atlas.get_tile_animation_mode(tile_coords)
				random_offset = mode == 1  # ANIMATION_MODE_RANDOM_START_TIMES

		var anim_count = 1
		if atlas.has_method("get_tile_animation_frames_count"):
			anim_count = atlas.get_tile_animation_frames_count(tile_coords)
			print("Tile (%d,%d): tile_animation_frames_count=%d, tile_columns=%d" % [tile_coords.x, tile_coords.y, anim_count, tile_columns])
		else:
			print("Tile (%d,%d): get_tile_animation_frames_count NOT FOUND" % [tile_coords.x, tile_coords.y])

		if anim_count > 1:
			animated = true
			for f in anim_count:
				var frame_coords = tile_coords + Vector2i(f, 0)
				var frame_tile_id = frame_coords.y * tile_columns + frame_coords.x
				anim_frames.append(frame_tile_id)
			var base_frame_ms = 125.0
			if atlas.has_method("get_tile_animation_frame_duration"):
				var dur_mult = atlas.get_tile_animation_frame_duration(tile_coords, 0)
				var anim_speed = atlas.get("animation_speed")
				if typeof(anim_speed) == TYPE_FLOAT and anim_speed > 0.0:
					base_frame_ms = (1.0 / anim_speed) * 1000.0
				frame_duration = int(base_frame_ms * dur_mult)
				print("  -> animation: %d frames, speed=%.1f, base_frame_ms=%.1f, dur_mult=%.2f, frameDuration=%d" % [anim_count, anim_speed if typeof(anim_speed) == TYPE_FLOAT else 8.0, base_frame_ms, dur_mult, frame_duration])
			else:
				frame_duration = int(base_frame_ms)
				print("  -> animation: %d frames, base_frame_ms=%.1f, frameDuration=%d (no frame duration method)" % [anim_count, base_frame_ms, frame_duration])

		var entry = {
			"id": tile_id,
			"collidable": collidable,
			"animated": animated,
		}
		if collision_polygons != null:
			entry["collisionPolygons"] = collision_polygons

		if animated and anim_frames.size() > 0:
			entry["frames"] = anim_frames
			entry["frameDuration"] = int(frame_duration)
			if random_offset:
				entry["randomOffset"] = true
			print("  -> tile #%d exported: animated=true, frames=%s, frameDuration=%d, randomOffset=%s" % [tile_id, anim_frames, int(frame_duration), random_offset])
		elif collision_polygons != null:
			print("  -> tile #%d exported: collisionPolygons=%d shapes" % [tile_id, collision_polygons.size()])
		else:
			print("  -> tile #%d exported: animated=%s" % [tile_id, animated])

		tiles.append(entry)

	return tiles


func _pick_output_dir() -> String:
	return "res://export/world"


func _build_world(layers: Array, root: Node, output_dir: String) -> Dictionary:
	var sources = []
	var source_map = {}
	var tile_size = 64
	var json_layers = []
	var bounds = null

	for layer in layers:
		var layer_name = layer.name.to_lower()
		var layer_type = _layer_type_for_name(layer_name)
		if layer_type.is_empty():
			continue

		var ts = layer.tile_set
		if ts == null:
			continue

		tile_size = ts.tile_size.x

		var data = []
		for cell_coords in layer.get_used_cells():
			var local_source_id = layer.get_cell_source_id(cell_coords)
			var atlas_coords = layer.get_cell_atlas_coords(cell_coords)
			var alt = layer.get_cell_alternative_tile(cell_coords)
			if alt == 0 and atlas_coords != Vector2i(-1, -1):
				var global_source_id = _get_or_create_source(sources, source_map, ts, local_source_id, output_dir, tile_size)
				if global_source_id < 0:
					continue
				var source_entry = _find_source_entry(sources, global_source_id)
				var tile_columns = source_entry.tileColumns
				var tile_id = atlas_coords.y * tile_columns + atlas_coords.x
				data.append([cell_coords.x, cell_coords.y, tile_id, global_source_id])

		json_layers.append({
			"name": layer_name,
			"type": layer_type,
			"tileSize": tile_size,
			"data": data,
		})

		var rect = layer.get_used_rect()
		if rect != Rect2i(0, 0, 0, 0):
			var layer_bounds = {
				"minX": rect.position.x * tile_size,
				"maxX": (rect.position.x + rect.size.x) * tile_size,
				"minY": rect.position.y * tile_size,
				"maxY": (rect.position.y + rect.size.y) * tile_size,
			}
			if bounds == null:
				bounds = layer_bounds
			else:
				bounds.minX = mini(bounds.minX, layer_bounds.minX)
				bounds.maxX = maxi(bounds.maxX, layer_bounds.maxX)
				bounds.minY = mini(bounds.minY, layer_bounds.minY)
				bounds.maxY = maxi(bounds.maxY, layer_bounds.maxY)

	if bounds == null:
		bounds = { "minX": -480, "maxX": 480, "minY": -480, "maxY": 480 }

	var spawn = _find_spawn(root, bounds)
	var objects = _find_objects(root, source_map, sources)

	var props = _find_props(root)

	return {
		"version": EXPORT_FORMAT_VERSION,
		"tileSize": tile_size,
		"sources": sources,
		"bounds": bounds,
		"spawn": spawn,
		"layers": json_layers,
		"objects": objects,
		"props": props,
	}


func _find_source_entry(sources: Array, source_id: int) -> Dictionary:
	for s in sources:
		if s.id == source_id:
			return s
	return { "tileColumns": 1 }


func _find_spawn(root: Node, bounds: Dictionary) -> Dictionary:
	for child in root.get_children():
		if child is Marker2D and child.name == "SpawnPoint":
			return { "x": child.position.x, "y": child.position.y }
		for grandchild in child.get_children():
			if grandchild is Marker2D and grandchild.name == "SpawnPoint":
				return { "x": grandchild.position.x, "y": grandchild.position.y }

	return {
		"x": (bounds.minX + bounds.maxX) / 2,
		"y": (bounds.minY + bounds.maxY) / 2,
	}


func _find_objects(root: Node, source_map: Dictionary, sources: Array) -> Array:
	var objects = []

	var object_layer = null
	for child in root.get_children():
		if child is TileMapLayer and child.name.to_lower() == "objects":
			object_layer = child
			break

	if object_layer == null:
		return objects

	var ts = object_layer.tile_set
	if ts == null:
		return objects

	var local_source_id = _detect_layer_source_id(object_layer)
	var ts_path = ts.resource_path
	if ts_path.is_empty():
		ts_path = str(ts.get_instance_id())
	var map_key = ts_path + ":" + str(local_source_id)
	var global_source_id = source_map.get(map_key, -1)

	var source_entry = _find_source_entry(sources, global_source_id)
	var tile_columns = source_entry.tileColumns

	var atlas_source = null
	for i in ts.get_source_count():
		var sid = ts.get_source_id(i)
		if sid == local_source_id:
			var src = ts.get_source(sid)
			if src is TileSetAtlasSource:
				atlas_source = src
				break

	var obj_id = 0
	for child in object_layer.get_children():
		if child is Marker2D:
			obj_id += 1
			var tile_id = child.get_meta("tile_id", 0)
			var animated = child.get_meta("animated", false)
			var coll_w = child.get_meta("collision_w", 0)
			var coll_h = child.get_meta("collision_h", 0)

			var obj = {
				"id": "object_" + str(obj_id),
				"sourceId": global_source_id,
				"tileId": tile_id,
				"x": child.position.x,
				"y": child.position.y,
			}

			if animated:
				var coords = Vector2i(tile_id % tile_columns, tile_id / tile_columns)
				var anim_count = 1
				if atlas_source != null and atlas_source.has_method("get_tile_animation_frames_count"):
					anim_count = atlas_source.get_tile_animation_frames_count(coords)
				if anim_count > 1:
					obj["animated"] = true
					obj["frames"] = []
					obj["frameDuration"] = 300
					for f in anim_count:
						var frame_coords = coords + Vector2i(f, 0)
						var frame_tile_id = frame_coords.y * tile_columns + frame_coords.x
						obj["frames"].append(frame_tile_id)

			if coll_w > 0 and coll_h > 0:
				obj["collision"] = { "width": coll_w, "height": coll_h }

			objects.append(obj)

	return objects


func _find_props(root: Node) -> Array:
	var props = []
	for child in root.get_children():
		if child is Marker2D and child.name == "Boombox":
			props.append({ "id": "boombox", "x": child.position.x, "y": child.position.y })
			break

	if props.is_empty():
		props.append({ "id": "boombox", "x": 0, "y": -200 })

	return props
