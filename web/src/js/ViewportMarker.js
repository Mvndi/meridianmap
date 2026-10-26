import L from "leaflet";

const VIEWPORT_PADDING = 0.25;

export const ViewportMarker = L.Marker.extend({
    getEvents: function () {
        return { ...L.Marker.prototype.getEvents.call(this), moveend: this.update, resize: this.update };
    },

    isVisible: function () {
        const size = this._map.getSize();
        const bounds = L.bounds(size.multiplyBy(-VIEWPORT_PADDING), size.multiplyBy(1 + VIEWPORT_PADDING));
        return bounds.contains(this._map.latLngToContainerPoint(this._latlng));
    },

    _initIcon: function () {
        if (this.isVisible()) L.Marker.prototype._initIcon.call(this);
    },

    _removeIcon: function () {
        if (this._icon) L.Marker.prototype._removeIcon.call(this);
    },

    update: function () {
        if (!this._map) return this;
        if (this.isVisible() || this._icon === document.activeElement) {
            if (!this._icon) this._initIcon();
        } else {
            this._removeIcon();
            this._removeShadow();
        }
        return L.Marker.prototype.update.call(this);
    },
});
