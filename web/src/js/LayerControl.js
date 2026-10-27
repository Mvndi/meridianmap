import { S } from "./Squaremap.js";
import L from "leaflet";
import { SquaremapTileLayer } from "./SquaremapTileLayer.js";

class LayerControl {
    /** @type {L.LayerGroup} */
    playersLayer;
    /** @type {L.Control.Layers} */
    controls;
    /** @type {L.TileLayer} */
    tileLayer;
    /** @type {L.Layer} */
    ignoreLayer;
    /** @type {L.TileLayer | null} */
    reliefLayer = null;

    init() {
        this.playersLayer = new L.LayerGroup();
        this.playersLayer.id = "players_layer";

        this.controls = L.control
            .layers(
                {},
                {},
                {
                    position: "topleft",
                    sortLayers: true,
                    sortFunction: (a, b) => {
                        return a.order - b.order;
                    },
                },
            )
            .addTo(S.map);
        // Meridian: the switches live in the side panel; Leaflet's own box stays as the registry only
        this.controls.getContainer().style.display = "none";
    }
    /**
     * @param name {string}
     * @param layer {L.Layer}
     * @param hide {boolean}
     */
    addOverlay(name, layer, hide) {
        layer._defaultHidden = hide;
        this.controls.addOverlay(layer, name);
        if (
            S.mapModes?.allowsOverlay(layer) !== false &&
            (S.mapModes?.isTerritory(layer) || this.shouldHide(layer, hide) !== true)
        ) {
            layer.addTo(S.map);
        }
        S.sidebar?.renderToggles();
    }
    /**
     * @param layer {L.Layer}
     */
    removeOverlay(layer) {
        this.ignoreLayer = layer;
        this.controls.removeLayer(layer);
        layer.remove();
        this.ignoreLayer = null;
        S.sidebar?.renderToggles();
    }
    /**
     * @param layer {L.Layer}
     * @param def {boolean}
     * @returns {boolean}
     */
    shouldHide(layer, def) {
        const value = window.localStorage.getItem(`hide_${layer.id}`);
        return value == null ? def : value === "true";
    }
    /**
     * @param layer {L.Layer}
     */
    hideLayer(layer) {
        if (layer !== this.ignoreLayer && !S.mapModes?.applying) {
            window.localStorage.setItem(`hide_${layer.id}`, "true");
        }
    }
    /**
     * @param layer {L.Layer}
     */
    showLayer(layer) {
        if (layer !== this.ignoreLayer && !S.mapModes?.applying) {
            window.localStorage.setItem(`hide_${layer.id}`, "false");
        }
    }
    /**
     * @param world {World}
     */
    setupTileLayers(world) {
        this.tileLayer?.remove();
        this.tileLayer = this.createTileLayer(world);

        this.setupReliefLayer(world);

        // refresh player's control
        this.removeOverlay(this.playersLayer);
        if (world.player_tracker.show_controls) {
            this.addOverlay(world.player_tracker.label, this.playersLayer, world.player_tracker.default_hidden);
        }
        this.playersLayer.order = world.player_tracker.priority;
        this.playersLayer.setZIndex(world.player_tracker.z_index);

        S.mapModes?.plots.attach();
        S.markets?.attach();
        S.markets?.render();
    }
    /**
     * @param world {World}
     * @returns {L.TileLayer}
     */
    createTileLayer(world) {
        return new SquaremapTileLayer(`tiles/${world.name}/{z}/{x}_{y}.png`, {
            tileSize: 512,
            updateWhenIdle: true,
            updateWhenZooming: false,
            minNativeZoom: 0,
            maxNativeZoom: world.zoom.max,
            errorTileUrl: "images/clear.png",
            fetchPriority: "high",
        }).addTo(S.map);
    }
    /**
     * Meridian: hill shading drawn over the map tiles and blended with them, switchable like any other layer.
     * @param world {World}
     */
    setupReliefLayer(world) {
        if (this.reliefLayer != null) {
            this.removeOverlay(this.reliefLayer);
            this.reliefLayer = null;
        }
        const relief = world.relief;
        if (relief == null || !relief.enabled) {
            return;
        }
        const pane = S.map.getPane("relief") || S.map.createPane("relief");
        pane.style.zIndex = "250";
        pane.style.pointerEvents = "none";
        pane.style.mixBlendMode = relief.blend_mode || "hard-light";
        pane.style.opacity = String(relief.opacity ?? 1);
        pane.style.visibility = "hidden";
        this.tileLayer.once("tileload", () => {
            pane.style.visibility = "";
        });
        this.reliefLayer = new SquaremapTileLayer(`tiles/${world.name}/relief/{z}/{x}_{y}.png`, {
            tileSize: 512,
            minNativeZoom: 0,
            maxNativeZoom: world.zoom.max,
            errorTileUrl: "images/clear.png",
            pane: "relief",
            updateWhenIdle: true,
            updateWhenZooming: false,
            fetchPriority: "low",
        });
        this.reliefLayer.id = "relief_layer";
        this.reliefLayer.order = -100;
        this.addOverlay(relief.label || "Relief", this.reliefLayer, relief.default_hidden === true);
    }
    updateTileLayer() {
        this.tileLayer.refresh();
        if (this.reliefLayer && S.map.hasLayer(this.reliefLayer)) this.reliefLayer.refresh();
    }
}

export { LayerControl };
