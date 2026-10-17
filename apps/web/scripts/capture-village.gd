extends SceneTree
## Website picture of the village (`public/brand/village_ingame.webp`), taken from the real game.
## Started by `scripts/sync-village.ts`; it only reads the game: a fresh test save (never the real
## one), every building open, a played world (no guide arrow, no first-visit cards), nothing
## affordable (no "!" markers), village time 11:00, no HUD and no building names (text would be in
## one language only). Window run with SOULWICK_QUIET=1 and --audio-driver Dummy (AGENTS.md §7):
## the window stays where QuietRun put it.
## Usage: godot --audio-driver Dummy --path <soulwick> -s <this file> -- <out_dir>
## Writes <out_dir>/village.png (1280×720, the game view at zoom 1: one art pixel = 2×2 pixels).

const STORAGE_ROOT := "user://web_village_storage"
## Camera centre and player position (world px) of the picture: forge, chronicle, fountain square,
## market stall, chickens and flower beds in one view.
const CAMERA_CENTER := Vector2(768, 630)
const PLAYER_SPOT := Vector2(700, 760)
const HOUR := 11.0
const UI_LAYERS: Array[StringName] = [&"Hud", &"GameUI", &"DungeonUI", &"VillageUI", &"BossIntroView"]


func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "user://web_village"
	DirAccess.make_dir_recursive_absolute(out)
	for bus in AudioServer.bus_count:
		AudioServer.set_bus_mute(bus, true)
	_prepare_storage()
	change_scene_to_file("res://scenes/main.tscn")
	await _seconds(2.2)
	current_scene.get("menu").play_slot(1)
	await _seconds(1.6)
	for i in 30:
		await process_frame
	var controller: Node = current_scene.get_node("WorldController")
	var village: Node = controller.get_world()
	var player: Node2D = controller.get_player()
	_set_daylight(village)
	for node in root.find_children("*", "CanvasLayer", true, false):
		var script: Script = node.get_script()
		if script != null and UI_LAYERS.has(script.get_global_name()):
			node.visible = false
	for label in village.find_children("Caption", "Label", true, false):
		label.visible = false
	player.global_position = PLAYER_SPOT
	var camera := Camera2D.new()
	village.add_child(camera)
	camera.global_position = CAMERA_CENTER
	camera.make_current()
	camera.reset_smoothing()
	await _seconds(1.0)
	var image := root.get_texture().get_image()
	image.save_png(out.path_join("village.png"))
	print("saved village.png ", image.get_size())
	quit()


func _prepare_storage() -> void:
	var absolute := ProjectSettings.globalize_path(STORAGE_ROOT)
	for dir_path in [absolute.path_join("saves"), absolute]:
		var dir := DirAccess.open(dir_path)
		if dir != null:
			for file in dir.get_files():
				DirAccess.remove_absolute(dir_path.path_join(file))
	DirAccess.make_dir_recursive_absolute(absolute)
	var save_manager := root.get_node("SaveManager")
	save_manager.set_storage_root(STORAGE_ROOT)
	save_manager.set_option(&"language", "en")
	TranslationServer.set_locale("en")
	save_manager.create_slot(1, "Lena", &"hero")
	save_manager.add_stat(&"runs", 4)
	save_manager.add_stat(&"deaths", 3)
	save_manager.add_stat(&"exits", 1)
	save_manager.add_stat(&"bosses", 1)
	for event in [&"event_first_run", &"event_first_crystal", &"event_first_boss"]:
		save_manager.unlock_content(event)
	for id in [&"unlock_first_run", &"unlock_first_crystal", &"unlock_first_boss", &"hint_controls",
			&"intro_forge", &"intro_trader", &"intro_chronicle", &"intro_guild", &"intro_home"]:
		save_manager.mark_seen(id)
	save_manager.save_game()


func _set_daylight(village: Node) -> void:
	var daylight: GDScript = load("res://world/village/village_daylight.gd")
	var vision := get_first_node_in_group(&"vision_overlay")
	if vision != null:
		vision.set_dark_color(daylight.dark_color_for_hour(HOUR), true)
		vision.set_vision(daylight.darkness_for_hour(HOUR), daylight.VISION_RADIUS, true)
	var ambience: Node = village.get_node_or_null("Ambience")
	if ambience != null:
		ambience.apply_mode(0)
		ambience.restart()


func _seconds(duration: float) -> void:
	await create_timer(duration, true, false, true).timeout
