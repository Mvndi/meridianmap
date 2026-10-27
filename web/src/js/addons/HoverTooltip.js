import L from "leaflet";

const openTooltip = L.Layer.prototype._openTooltip;

L.Layer.include({
    _openTooltip: function (event) {
        // Leaflet queues drag hovers until moveend, even after the cursor has left the marker.
        if (!this._tooltip?.options.permanent && this._map?.dragging?.moving()) return;
        openTooltip.call(this, event);
    },
});
