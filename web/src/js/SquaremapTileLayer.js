import L from "leaflet";

export const SquaremapTileLayer = L.TileLayer.extend({
    initialize: function (url, options) {
        L.TileLayer.prototype.initialize.call(this, url, options);
        this.requests = new WeakMap();
        this.on("tileunload tileabort", (event) => this.requests.get(event.tile)?.controller?.abort());
    },

    createTile: function (coords, done) {
        const tile = document.createElement("img");
        tile.alt = "";
        tile.setAttribute("role", "presentation");
        if (this.options.crossOrigin || this.options.crossOrigin === "") {
            tile.crossOrigin = this.options.crossOrigin === true ? "" : this.options.crossOrigin;
        }
        this.requests.set(tile, { coords, controller: null, etag: null, ready: false });
        this.loadTile(tile, done);
        return tile;
    },

    refresh: function () {
        for (const entry of Object.values(this._tiles ?? {})) {
            if (entry.current) this.loadTile(entry.el);
        }
    },

    loadTile: async function (tile, done) {
        const request = this.requests.get(tile);
        if (request.controller) return;
        const controller = new AbortController();
        request.controller = controller;
        let failure;
        try {
            await this.updateTile(tile, request);
        } catch (error) {
            failure = error;
        } finally {
            request.controller = null;
        }
        if (!controller.signal.aborted) this.completeTile(tile, done, failure);
    },

    updateTile: async function (tile, request) {
        const response = await fetch(this.getTileUrl(request.coords), {
            cache: "no-cache",
            signal: request.controller.signal,
        });
        if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
        const etag = response.headers.get("ETag");
        if (etag && etag === request.etag) {
            await response.body?.cancel();
            return;
        }
        await this.replaceTile(tile, await response.blob());
        request.etag = etag;
    },

    replaceTile: async function (tile, blob) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            const replacement = new Image();
            replacement.src = objectUrl;
            await replacement.decode();
            this.requests.get(tile).controller.signal.throwIfAborted();
            tile.src = objectUrl;
            await tile.decode();
            L.DomUtil.addClass(tile, "leaflet-tile-loaded");
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    },

    completeTile: function (tile, done, error) {
        if (error) {
            if (done) {
                tile.src = this.options.errorTileUrl || L.Util.emptyImageUrl;
                done(error, tile);
            }
            return;
        }
        const request = this.requests.get(tile);
        if (!done && !request.ready) this._tileReady(request.coords, null, tile);
        request.ready = true;
        done?.(null, tile);
    },
});
