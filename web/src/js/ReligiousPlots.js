import L from "leaflet";
import { S } from "./Squaremap.js";

const PLOT_ICON = L.divIcon({
    className: "religious-plot-icon",
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8 12 2l10 6v2H2Zm3 4h3v7H5Zm6 0h3v7h-3Zm6 0h3v7h-3ZM2 21h20v2H2Z"/></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    tooltipAnchor: [0, -12],
});
const FALLBACK_COLOR = "#b797c4";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

class ReligiousPlots {
    constructor() {
        this.plots = [];
        this.layer = new L.LayerGroup();
        this.layer.id = "religious_plots_layer";
        this.layer.order = 51;
        this.world = null;
    }

    attach() {
        S.layerControl.removeOverlay(this.layer);
        S.layerControl.addOverlay("Religious plots", this.layer, false);
        this.draw();
    }

    update(plots) {
        const world = S.worldList?.curWorld?.name;
        if (this.plots === plots && this.world === world) return;
        this.plots = Array.isArray(plots) ? plots : [];
        this.draw();
    }

    draw() {
        this.layer.clearLayers();
        const world = S.worldList?.curWorld;
        this.world = world?.name;
        if (!world?.zoom) return;
        for (const plot of this.plots) {
            if (plot.world?.replace(":", "_") === world.name) this.drawPlot(plot);
        }
    }

    drawPlot(plot) {
        const color = HEX_COLOR.test(plot.religion?.color) ? plot.religion.color : FALLBACK_COLOR;
        const bounds = [S.toLatLng(plot.x, plot.z), S.toLatLng(plot.x + plot.size, plot.z + plot.size)];
        const label = `${plot.religion?.name ?? "Religion"} · ${plot.town}`;
        const tooltip = document.createElement("span");
        tooltip.textContent = label;
        L.rectangle(bounds, { color, weight: 2, fillColor: color, fillOpacity: 0.3 })
            .bindTooltip(tooltip)
            .addTo(this.layer);
        const popup = document.createElement("div");
        popup.textContent = `${label} · ${plot.x}, ${plot.z}`;
        L.marker(S.toLatLng(plot.x + plot.size / 2, plot.z + plot.size / 2), {
            icon: PLOT_ICON,
            title: label,
            alt: label,
        })
            .bindTooltip(tooltip.cloneNode(true))
            .bindPopup(popup)
            .addTo(this.layer);
    }
}

export { ReligiousPlots };
