import { S } from "./Squaremap.js";
import { store } from "./Sidebar.js";

const MODES = ["political", "religion", "diplomacy"];
const RELATIONS = {
    own: { label: "Selected nation", color: "#e5c45c" },
    ally: { label: "Ally", color: "#54b889" },
    enemy: { label: "Enemy", color: "#e16b70" },
    neutral: { label: "Neutral", color: "#929dab" },
    independent: { label: "Independent town", color: "#b797c4" },
};
const NONE = "none";
const INDEPENDENT_COLOR = "#3388ff";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const REFRESH_TICKS = 15;
const COLOR_HASH_OFFSET = 2166136261;
const COLOR_HASH_PRIME = 16777619;
const HUE_COUNT = 360;

function religionColor(religion) {
    const id = religion?.id;
    if (id && id !== NONE && HEX_COLOR.test(religion?.color)) return religion.color;
    if (!id || id === NONE) return "#929dab";
    let hash = COLOR_HASH_OFFSET;
    for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), COLOR_HASH_PRIME);
    return `hsl(${(hash >>> 0) % HUE_COUNT} 55% 60%)`;
}

class MapModes {
    constructor() {
        this.mode = store.get("mode", "political");
        if (!MODES.includes(this.mode)) this.mode = "political";
        this.selected = store.get("nation", "");
        this.data = { nations: [], towns: {}, religion_available: false };
        this.nations = new Map();
        this.applying = false;
        this.loaded = false;
        this.loading = false;
        this.failed = false;
        this.buttons = document.querySelectorAll("[data-map-mode]");
        this.select = document.getElementById("diplomacy-nation");
        this.context = document.getElementById("mode-context");
        this.legend = document.getElementById("mode-legend");
        for (const button of this.buttons) button.addEventListener("click", () => this.setMode(button.dataset.mapMode));
        this.select.addEventListener("change", () => this.selectNation(this.select.value));
        this.render();
    }

    tick() {
        if (S.tick_count % REFRESH_TICKS === 0) this.load();
    }

    async load() {
        if (this.loading) return;
        this.loading = true;
        try {
            const response = await fetch("tiles/map-modes.json", { cache: "no-store" });
            if (!response.ok) throw new Error(String(response.status));
            const data = await response.json();
            if (!Array.isArray(data.nations) || !data.towns) throw new Error("Invalid map data");
            this.data = data;
            this.nations = new Map(data.nations.map((nation) => [nation.id, nation]));
            if (!this.nations.has(this.selected)) this.selected = "";
            this.loaded = true;
            this.failed = false;
            this.renderNations();
        } catch {
            this.failed = true;
        } finally {
            this.loading = false;
            this.apply();
        }
    }

    setMode(mode) {
        if (!MODES.includes(mode)) return;
        this.mode = mode;
        store.set("mode", mode);
        this.apply();
    }

    selectNation(id) {
        this.selected = this.nations.has(id) ? id : "";
        store.set("nation", this.selected);
        this.apply();
    }

    isTerritory(layer) {
        return layer.id === "towny";
    }

    allowsOverlay(layer) {
        return layer.id !== "nation_protection" || this.mode === "political";
    }

    bindMarker(layer, wrapper) {
        if (!this.isTerritory(layer)) return;
        const id = String(wrapper.id ?? "").match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
        if (!id) return;
        const marker = wrapper.marker;
        marker._townId = id;
        marker._politicalStyle = { ...marker.options };
        delete marker._politicalStyle.renderer;
        marker.on("click", () => {
            const town = this.data.towns[id];
            if (this.mode === "diplomacy" && town?.nation) this.selectNation(town.nation);
        });
        this.styleMarker(marker);
    }

    relation(nation) {
        if (!nation) return "independent";
        if (nation === this.selected) return "own";
        const selected = this.nations.get(this.selected);
        const other = this.nations.get(nation);
        if (selected?.enemies.includes(nation) || other?.enemies.includes(this.selected)) return "enemy";
        return selected?.allies.includes(nation) ? "ally" : "neutral";
    }

    styleMarker(marker) {
        if (!marker.setStyle || !marker._townId) return;
        const town = this.data.towns[marker._townId];
        const original = marker._politicalStyle;
        if (!town || !this.loaded) {
            marker.setStyle(original);
            return;
        }
        const color = this.territoryColor(town);
        const fillOpacity = Math.max(original.fillOpacity ?? 0.2, 0.3);
        if (
            marker.options.color === color &&
            marker.options.fillColor === color &&
            marker.options.fillOpacity === fillOpacity
        )
            return;
        marker.setStyle({
            ...original,
            color,
            fillColor: color,
            fillOpacity,
        });
    }

    territoryColor(town) {
        if (this.mode === "religion") return religionColor(town.religion);
        if (this.mode === "diplomacy" && this.selected) return RELATIONS[this.relation(town.nation)].color;
        return this.nations.get(town.nation)?.color ?? this.independentColor();
    }

    independentColor() {
        return HEX_COLOR.test(this.data.independent_color) ? this.data.independent_color : INDEPENDENT_COLOR;
    }

    apply() {
        this.applying = true;
        try {
            S.layerControl.controls._layers
                .filter((entry) => entry.overlay)
                .forEach(({ layer }) => this.applyLayer(layer));
        } finally {
            this.applying = false;
        }
        this.render();
        S.sidebar.renderToggles();
    }

    applyLayer(layer) {
        if (!this.allowsOverlay(layer)) {
            layer.remove();
            return;
        }
        if (layer.id !== "nation_protection" && !this.isTerritory(layer)) return;
        const show = this.isTerritory(layer) || !S.layerControl.shouldHide(layer, layer._defaultHidden);
        if (show) layer.addTo(S.map);
        else layer.remove();
        if (this.isTerritory(layer)) layer.eachLayer((marker) => this.styleMarker(marker));
    }

    renderNations() {
        const placeholder = new Option("Choose a nation", "");
        const nations = [...this.nations.values()].sort((a, b) => a.name.localeCompare(b.name));
        this.select.replaceChildren(placeholder, ...nations.map((nation) => new Option(nation.name, nation.id)));
        this.select.value = this.selected;
    }

    render() {
        for (const button of this.buttons)
            button.setAttribute("aria-pressed", String(button.dataset.mapMode === this.mode));
        document.getElementById("diplomacy-controls").hidden = this.mode !== "diplomacy";
        this.select.value = this.selected;
        if (this.failed) this.context.textContent = "Territory information is unavailable. Showing the last map data.";
        else if (!this.loaded) this.context.textContent = "Loading territory information…";
        else if (this.mode === "religion")
            this.context.textContent = this.data.religion_available
                ? "Town claims coloured by religion."
                : "Religion information is unavailable.";
        else if (this.mode === "diplomacy")
            this.context.textContent = this.selected
                ? `Relations with ${this.nations.get(this.selected)?.name}. Click territory to change nation.`
                : "Choose a nation or click its territory to see allies and enemies.";
        else this.context.textContent = "Town claims coloured by nation.";
        this.renderLegend();
    }

    renderLegend() {
        let entries = [];
        if (this.mode === "diplomacy" && this.selected) entries = Object.values(RELATIONS);
        if (this.mode === "religion" && this.data.religion_available) {
            const religions = new Map(Object.values(this.data.towns).map((town) => [town.religion.id, town.religion]));
            if (!religions.has(NONE)) religions.set(NONE, { id: NONE });
            entries = [...religions.values()]
                .sort((a, b) => {
                    if (a.id === NONE) return -1;
                    if (b.id === NONE) return 1;
                    return a.name.localeCompare(b.name);
                })
                .map((religion) => ({
                    label: religion.id === NONE ? "No religion" : religion.name,
                    color: religionColor(religion),
                }));
        }
        this.legend.replaceChildren(...entries.map((entry) => this.createLegendItem(entry)));
    }

    createLegendItem({ label, color }) {
        const item = document.createElement("span");
        item.className = "mode-key";
        const swatch = document.createElement("i");
        swatch.style.backgroundColor = color;
        item.append(swatch, document.createTextNode(label));
        return item;
    }
}

export { MapModes };
