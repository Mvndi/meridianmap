import { World } from "./util/World.js";
import { S } from "./Squaremap.js";

class WorldList {
    /** @type {Map<string, World>} */
    worlds;
    /** @type {World} */
    curWorld;

    /**
     * @param json {Settings_World[]}
     */
    constructor(json) {
        // get worlds from json
        /** @type {Map<string, World>} */
        const unorderedMap = new Map();
        for (let i = 0; i < json.length; i++) {
            const world = new World(json[i]);
            unorderedMap.set(world.name, world);
        }

        // sort worlds by order
        this.worlds = new Map([...unorderedMap].sort((a, b) => a[1].order - b[1].order));

        this.createWorldPicker();
    }

    createWorldPicker() {
        if (this.worlds.size < 2) return;
        this.picker = document.createElement("details");
        this.picker.id = "world-picker";
        this.picker.className = "world-picker";
        const heading = document.createElement("summary");
        this.worldLabel = document.createElement("span");
        heading.append(this.worldLabel);
        this.search = document.createElement("input");
        this.search.id = "world-search";
        this.search.className = "search";
        this.search.type = "search";
        this.search.placeholder = "Find a world";
        this.search.setAttribute("aria-label", "Find a world");
        this.options = document.createElement("div");
        this.options.className = "world-options";
        this.picker.append(heading, this.search, this.options);
        S.sidebar.worlds.element.append(this.picker);
        this.bindWorldPicker();
    }

    bindWorldPicker() {
        this.search.addEventListener("input", () => this.renderWorldOptions());
        this.picker.addEventListener("toggle", () => {
            if (this.picker.open) this.search.focus();
        });
        document.addEventListener("click", (event) => {
            if (!this.picker.contains(event.target)) this.picker.open = false;
        });
        this.picker.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            this.picker.open = false;
            this.picker.querySelector("summary").focus();
        });
    }

    renderWorldOptions() {
        if (!this.picker) return;
        const query = this.search.value.trim().toLowerCase().replace(/[_:]/g, " ");
        const matches = [...this.worlds.values()].filter((world) =>
            `${world.display_name} ${world.name}`.toLowerCase().replace(/[_:]/g, " ").includes(query),
        );
        const options = matches.map((world) => this.createWorldOption(world));
        if (!options.length) {
            const empty = document.createElement("p");
            empty.className = "empty";
            empty.textContent = "No worlds match your search.";
            options.push(empty);
        }
        this.options.replaceChildren(...options);
    }

    createWorldOption(world) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `world-${world.name}`;
        button.className = "world-option";
        button.textContent = world.display_name;
        button.setAttribute("aria-pressed", String(world === this.curWorld));
        button.addEventListener("click", () => this.selectWorld(world));
        return button;
    }

    selectWorld(world) {
        this.picker.open = false;
        this.search.value = "";
        this.showWorld(world.name, () => S.centerOn(world.center.x, world.center.z, world.zoom.def));
        this.renderWorldOptions();
    }

    /**
     * @param {World} world
     * @returns {string}
     */
    getIcon(world) {
        if (world.icon != null && world.icon !== "") {
            return `images/icon/${world.icon}.png`;
        }
        switch (world.type) {
            case "nether":
                return "images/icon/red-cube-smol.png";
            case "the_end":
                return "images/icon/purple-cube-smol.png";
            case "normal":
            default:
                return "images/icon/green-cube-smol.png";
        }
    }
    /**
     * @param json {Settings}
     * @param callback {(world: World) => void}
     */
    loadInitialWorld(json, callback) {
        let updateUrl = false;
        let name = S.getUrlParam("world", null);
        if (name != null) {
            const world = this.worlds.get(name);
            if (world == null) {
                updateUrl = true;
                name = null;
            }
        }
        if (name == null) {
            name = json.worlds.sort((a, b) => a.order - b.order)[0].name;
        }
        this.loadWorld(name, (a) => {
            callback(a);
            if (updateUrl) {
                S.updateBrowserUrl(`?world=${this.curWorld.name}`);
            }
        });
    }
    /**
     * @param {string} name
     * @param {(world: World) => void} callback
     */
    loadWorld(name, callback) {
        // unload current world
        if (this.curWorld != null) {
            this.curWorld.unload();
        }

        // load new world
        const world = this.worlds.get(name);
        this.curWorld = world;
        if (this.worldLabel) this.worldLabel.textContent = world.display_name;
        this.renderWorldOptions();
        world.load(callback);
    }
    /**
     * @param {string} name
     * @param {(world: World) => void} callback
     */
    showWorld(name, callback) {
        if (this.curWorld.name === name) {
            if (callback != null) {
                callback();
            }
            return;
        }
        this.loadWorld(name, () => {
            callback();
            S.updateBrowserUrl(`?world=${this.curWorld.name}`);
        });
    }
}

export { WorldList };
