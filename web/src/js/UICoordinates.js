import { S } from "./Squaremap.js";
import L from "leaflet";

import { earthCoordinates } from "./util/Geography.js";

const fmt = (n) => Math.floor(n).toLocaleString("en-US").replace("-", "−");

function latLon(x, z) {
    const { latitude: lat, longitude: lon } = earthCoordinates(x, z);
    if (lat > 90 || lat < -90 || lon < -180 || lon > 180) return "";
    const ns = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
    const ew = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
    return `${ns}  ${ew}`;
}

/** Meridian: where the mouse is, as block coordinates and (on Earth) real latitude and longitude. */
class UICoordinates {
    /**
     * @param {Settings_UI_Coordinates} json
     * @param {boolean} show
     */
    constructor(json, show) {
        const Coords = L.Control.extend({
            options: { position: "bottomleft" },
            onAdd: function () {
                const box = L.DomUtil.create("div", "m-coords");
                box.setAttribute("aria-live", "off");
                this._xz = L.DomUtil.create("span", "xz", box);
                this._ll = L.DomUtil.create("span", "ll", box);
                L.DomEvent.disableClickPropagation(box);
                return box;
            },
            update: function (point) {
                if (point == null) {
                    this._xz.textContent = "X —  Z —";
                    this._ll.textContent = "";
                    return;
                }
                this._xz.textContent = `X ${fmt(point.x)}  Z ${fmt(point.y)}`;
                const earth = S.worldList.curWorld?.type === "normal";
                this._ll.textContent = earth ? latLon(point.x, point.y) : "";
            },
        });
        this.showCoordinates = show;
        this.coords = new Coords();
        S.map.addControl(this.coords);
        S.map.on("mousemove", (event) => {
            if (S.worldList.curWorld != null) {
                const point = S.globe?.active ? S.globe.toPoint(event.containerPoint) : S.toPoint(event.latlng);
                this.coords.update(point);
            }
        });
        S.map.on("mouseout", () => this.coords.update(null));
        if (!show || !json.enabled) {
            this.coords.getContainer().hidden = true;
        }
        this.coords.update(null);

        // Meridian: right-click (long-press on phones) a spot to copy its coordinates
        S.map.on("contextmenu", (event) => {
            if (S.globe?.active) {
                S.globe.openMap(event);
                return;
            }
            if (S.worldList.curWorld != null) {
                this.openCopyPopup(event.latlng);
            }
        });
    }

    /** A small popup at the clicked spot: its coordinates and a button that copies "Coordinates: X, Z". */
    openCopyPopup(latlng) {
        const point = S.toPoint(latlng);
        const x = Math.floor(point.x);
        const z = Math.floor(point.y);
        const text = `Coordinates: ${x}, ${z}`;

        const box = document.createElement("div");
        box.className = "coord-pop";
        const xz = document.createElement("div");
        xz.className = "cp-xz";
        xz.textContent = `X ${fmt(x)}  Z ${fmt(z)}`;
        box.appendChild(xz);
        if (S.worldList.curWorld?.type === "normal") {
            const ll = document.createElement("div");
            ll.className = "cp-ll";
            ll.textContent = latLon(x, z);
            if (ll.textContent) box.appendChild(ll);
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cp-copy";
        button.textContent = "Copy coordinates";
        button.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(text);
                button.textContent = "Copied";
            } catch {
                // clipboard blocked: show the text selected so it can be copied by hand
                const field = document.createElement("input");
                field.className = "cp-field";
                field.readOnly = true;
                field.value = text;
                button.replaceWith(field);
                field.focus();
                field.select();
            }
        });
        box.appendChild(button);
        L.popup({ className: "m-popup", offset: [0, -2], autoPan: true })
            .setLatLng(latlng)
            .setContent(box)
            .openOn(S.map);
    }
}

export { UICoordinates };
