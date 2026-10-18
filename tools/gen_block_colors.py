import argparse
import io
import json
import pathlib
import zipfile
from contextlib import ExitStack
from functools import lru_cache

from PIL import Image

DEFAULT_OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "common" / "src" / "main" / "resources" / "squaremap" / "block_colors.txt"
MAX_MODEL_DEPTH = 20
MIN_ALPHA = 16


class ResourceAssets:
    def __init__(self, root, stack):
        self.root = root
        self.archive = stack.enter_context(zipfile.ZipFile(root)) if root.is_file() else None
        if self.archive is None and not root.is_dir():
            raise FileNotFoundError(root)

    def read(self, name):
        if self.archive is not None:
            try:
                return self.archive.read(name)
            except KeyError:
                return None
        path = self.root / name
        return path.read_bytes() if path.is_file() else None

    def names(self):
        if self.archive is not None:
            return self.archive.namelist()
        return [path.relative_to(self.root).as_posix() for path in self.root.rglob("*.json")]


class ResourceLayers:
    def __init__(self, vanilla, packs, pack_format):
        self.layers = [(vanilla, "")]
        for pack in packs:
            self.layers.append((pack, ""))
            metadata = pack.read("pack.mcmeta")
            if metadata is None:
                raise ValueError(f"Missing pack.mcmeta in {pack.root}")
            entries = json.loads(metadata).get("overlays", {}).get("entries", [])
            for entry in entries:
                if supports_format(entry, pack_format):
                    self.layers.append((pack, entry["directory"] + "/"))

    def read(self, name):
        for assets, prefix in reversed(self.layers):
            content = assets.read(prefix + name)
            if content is not None:
                return content
        return None

    @lru_cache(maxsize=None)
    def model(self, name):
        content = self.read(asset_path(name, "models", ".json"))
        return json.loads(content) if content is not None else None


def format_version(value):
    return tuple(value) if isinstance(value, list) else (value, 0)


def supports_format(entry, pack_format):
    if "min_format" in entry:
        lower = entry["min_format"]
        upper = entry["max_format"]
    else:
        formats = entry.get("formats", {})
        if isinstance(formats, int):
            return formats == pack_format
        if isinstance(formats, list):
            return formats[0] <= pack_format <= formats[-1]
        lower = formats.get("min_inclusive", 0)
        upper = formats.get("max_inclusive", pack_format)
    return format_version(lower) <= format_version(pack_format) <= format_version(upper)


def asset_path(identifier, directory, suffix):
    namespace, separator, name = identifier.partition(":")
    if not separator:
        namespace, name = "minecraft", identifier
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Invalid resource identifier: {identifier}")
    return f"assets/{namespace}/{directory}/{name}{suffix}"


GRASS = {"grass_block", "short_grass", "tall_grass", "fern", "large_fern", "potted_fern", "sugar_cane", "bush"}
FOLIAGE = {"oak_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "vine"}
WATER = {"water", "bubble_column", "water_cauldron"}
FIXED = {"spruce_leaves": 0x619961, "birch_leaves": 0x80A755, "lily_pad": 0x208030, "attached_melon_stem": 0xE0C71C,
         "attached_pumpkin_stem": 0xE0C71C, "redstone_wire": 0x960000}
# blocks without a same-named model: the texture to use instead
TEXTURE_FALLBACK = {
    "water": "block/water_still", "lava": "block/lava_still", "bubble_column": "block/water_still",
    "fire": "block/fire_0", "soul_fire": "block/soul_fire_0", "redstone_wire": "block/redstone_dust_dot",
    "kelp": "block/kelp", "kelp_plant": "block/kelp_plant", "seagrass": "block/seagrass", "tall_seagrass": "block/tall_seagrass_top",
    "snow": "block/snow", "powder_snow": "block/powder_snow", "cave_vines": "block/cave_vines", "cave_vines_plant": "block/cave_vines_plant",
    "twisting_vines": "block/twisting_vines", "weeping_vines": "block/weeping_vines", "big_dripleaf": "block/big_dripleaf_top",
    "small_dripleaf": "block/small_dripleaf_top", "pitcher_plant": "block/pitcher_crop_top_stage_4",
    "tall_grass": "block/tall_grass_top", "large_fern": "block/large_fern_top", "sunflower": "block/sunflower_front",
    "lilac": "block/lilac_top", "rose_bush": "block/rose_bush_top", "peony": "block/peony_top",
}
# suffixes to try when a block has no model with its exact name
SUFFIXES = ["", "_top", "_upper", "_floor", "_stage3", "_stage7", "_stage_3", "_age3", "_bottom", "_inventory", "_0",
            "_1", "_noside", "_post", "_side", "_on", "_off", "_single", "_one", "_1_age0", "_bottom_left"]


def resolve(assets, name):
    textures, elements = {}, None
    visited = set()
    while name and name not in visited and len(visited) < MAX_MODEL_DEPTH:
        visited.add(name)
        model = assets.model(name)
        if model is None:
            break
        for key, value in model.get("textures", {}).items():
            textures.setdefault(key, value)
        if elements is None and "elements" in model:
            elements = model["elements"]
        name = model.get("parent")
    return textures, elements or []


def deref(tex, textures):
    for _ in range(10):
        if tex and tex.startswith("#"):
            tex = textures.get(tex[1:])
        else:
            break
    return tex


def top_texture(assets, model_name):
    textures, elements = resolve(assets, model_name)
    best, best_y, tinted = None, -1, False
    for el in elements:
        faces = el.get("faces", {})
        if "up" in faces:
            y = el.get("to", [0, 0, 0])[1]
            if y >= best_y:
                best, best_y, tinted = faces["up"].get("texture"), y, "tintindex" in faces["up"]
    tex = deref(best, textures)
    if not tex:
        # flat or cross models (flowers, saplings, rails): no up face
        for k in ("top", "end", "up", "all", "texture", "cross", "plant", "rail", "flower", "crop", "particle", "side"):
            if k in textures:
                tex = deref("#" + k, textures)
                if tex:
                    break
        tinted = any("tintindex" in f for el in elements for f in el.get("faces", {}).values())
    return tex, tinted


def average(assets, texture):
    content = assets.read(asset_path(texture, "textures", ".png"))
    if content is None:
        return None
    img = Image.open(io.BytesIO(content)).convert("RGBA")
    metadata = assets.read(asset_path(texture, "textures", ".png.mcmeta"))
    if metadata is not None:
        animation = json.loads(metadata).get("animation")
        if animation is not None:
            img = first_frame(img, animation)
    r = g = b = n = 0.0
    pixels = img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata()
    for pr, pg, pb, pa in pixels:
        if pa < MIN_ALPHA:
            continue
        a = pa / 255.0
        r += pr * a
        g += pg * a
        b += pb * a
        n += a
    if n == 0:
        return None
    return int(r / n), int(g / n), int(b / n)


def first_frame(image, animation):
    default_size = min(image.size)
    width = animation.get("width", image.width if "height" in animation else default_size)
    height = animation.get("height", image.height if "width" in animation else default_size)
    frames = animation.get("frames", [0])
    frame = frames[0] if frames else 0
    index = frame["index"] if isinstance(frame, dict) else frame
    if width <= 0 or height <= 0 or image.width % width or image.height % height:
        raise ValueError("Invalid animation frame dimensions")
    columns = image.width // width
    if index < 0 or index >= columns * (image.height // height):
        raise ValueError("Animation frame index is outside the texture")
    x, y = index % columns * width, index // columns * height
    return image.crop((x, y, x + width, y + height))


def block_ids(vanilla):
    prefixes = ("data/minecraft/loot_table/blocks/", "assets/minecraft/models/block/")
    ids = {pathlib.PurePosixPath(name).stem for name in vanilla.names() if name.startswith(prefixes) and name.endswith(".json")}
    return sorted(ids | set(TEXTURE_FALLBACK) | GRASS | FOLIAGE | WATER | set(FIXED))


def block_color(assets, block):
    if block in TEXTURE_FALLBACK:
        return average(assets, TEXTURE_FALLBACK[block])
    for suffix in SUFFIXES:
        texture, _ = top_texture(assets, "block/" + block + suffix)
        if texture:
            color = average(assets, texture)
            if color is not None:
                return color
    return None


def format_color(block, rgb):
    tint = ""
    if block in FIXED:
        fixed = FIXED[block]
        rgb = (rgb[0] * (fixed >> 16 & 255) // 255, rgb[1] * (fixed >> 8 & 255) // 255, rgb[2] * (fixed & 255) // 255)
    elif block in GRASS:
        tint = " grass"
    elif block in FOLIAGE:
        tint = " foliage"
    elif block in WATER:
        tint = " water"
    return f"minecraft:{block} {rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}{tint}"


def generate(assets, vanilla):
    lines, missing = [], []
    fallback = ResourceLayers(vanilla, [], 0)
    for block in block_ids(vanilla):
        rgb = block_color(assets, block)
        if rgb is None:
            rgb = block_color(fallback, block)
        if rgb is None:
            missing.append(block)
            continue
        lines.append(format_color(block, rgb))
    return lines, missing


def parse_arguments():
    parser = argparse.ArgumentParser(description="Generate Meridian block colours from vanilla assets with resource-pack overrides.")
    parser.add_argument("vanilla", type=pathlib.Path, help="Vanilla client JAR or extracted client directory")
    parser.add_argument("--resource-pack", type=pathlib.Path, action="append", default=[], help="Pack directory or ZIP; repeat in increasing priority order")
    parser.add_argument("--pack-format", type=int, default=75, help="Resource-pack format for selecting overlays (75 for 1.21.11)")
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main():
    args = parse_arguments()
    with ExitStack() as stack:
        vanilla = ResourceAssets(args.vanilla, stack)
        packs = [ResourceAssets(path, stack) for path in args.resource_pack]
        assets = ResourceLayers(vanilla, packs, args.pack_format)
        lines, missing = generate(assets, vanilla)
    sources = ["vanilla"] + [path.name for path in args.resource_pack]
    header = f"# generated by tools/gen_block_colors.py from {' + '.join(sources)} (pack format {args.pack_format})\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(lines)} block colours written to {args.output}; no texture found for {len(missing)} ids")
    print("missing:", " ".join(missing[:80]))


if __name__ == "__main__":
    main()
