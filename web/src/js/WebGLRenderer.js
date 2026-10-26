import L from "leaflet";
import { Renderer } from "@pixi/core";
import { Container } from "@pixi/display";
import { Graphics } from "@pixi/graphics";

const MAX_RESOLUTION = 2;

const WebGLRenderer = L.Canvas.extend({
    initialize: function (gpu) {
        L.Canvas.prototype.initialize.call(this);
        this.gpu = gpu;
        this.scene = new Container();
        this.scene.eventMode = "none";
        this.graphics = new Map();
    },

    _initContainer: function () {
        const canvas = (this._container = this.gpu.view);
        canvas._leaflet_disable_events = true;
        L.DomEvent.on(canvas, "mousemove", this._onMouseMove, this);
        L.DomEvent.on(canvas, "click dblclick mousedown mouseup contextmenu", this._onClick, this);
        L.DomEvent.on(canvas, "mouseout", this._handleMouseOut, this);
        L.DomEvent.on(canvas, "webglcontextlost", this.loseContext, this);
    },

    _destroyContainer: function () {
        L.Canvas.prototype._destroyContainer.call(this);
        this.scene.destroy({ children: true });
        this.graphics.clear();
        this.gpu.destroy();
    },

    _update: function () {
        if (this._map._animatingZoom && this._bounds) return;
        L.Renderer.prototype._update.call(this);
        const size = this._bounds.getSize();
        L.DomUtil.setPosition(this._container, this._bounds.min);
        this.gpu.resize(size.x, size.y);
        this.scene.position.set(-this._bounds.min.x, -this._bounds.min.y);
        this.fire("update");
    },

    _initPath: function (layer) {
        L.Canvas.prototype._initPath.call(this, layer);
        const shape = new Graphics();
        this.scene.addChild(shape);
        this.graphics.set(layer, { shape });
    },

    _removePath: function (layer) {
        this.graphics.get(layer).shape.destroy();
        this.graphics.delete(layer);
        L.Canvas.prototype._removePath.call(this, layer);
    },

    _updateStyle: function (layer) {
        this._updatePoly(layer);
    },

    _updatePoly: function (layer) {
        const entry = this.graphics.get(layer);
        if (!entry || !layer._rings) return;
        entry.shape.visible = Boolean(layer._pxBounds?.intersects(this._bounds));
        const style = styleKey(layer.options);
        if (entry.rings === layer._rings && entry.style === style) return;
        entry.rings = layer._rings;
        entry.style = style;
        this.drawPolygon(entry.shape, layer);
        this._requestRedraw(layer);
    },

    drawPolygon: function (shape, layer) {
        const options = layer.options;
        shape.clear();
        shape.lineStyle({
            width: options.stroke ? options.weight : 0,
            color: options.color,
            alpha: options.opacity,
            cap: options.lineCap,
            join: options.lineJoin,
        });
        if (options.fill) shape.beginFill(options.fillColor || options.color, options.fillOpacity);
        this.drawRings(shape, layer);
        shape.endFill();
    },

    drawRings: function (shape, layer) {
        const latlngs = layer.getLatLngs();
        const polygons = Array.isArray(latlngs[0]?.[0]) ? latlngs : [latlngs];
        let index = 0;
        for (const polygon of polygons) {
            for (let ring = 0; ring < polygon.length; ring++) {
                if (ring > 0) shape.beginHole();
                shape.drawPolygon(layer._rings[index++]);
                if (ring > 0) shape.endHole();
            }
        }
    },

    _requestRedraw: function () {
        if (this._map && !this.failed) {
            this._redrawRequest ??= L.Util.requestAnimFrame(this._redraw, this);
        }
    },

    _redraw: function () {
        L.Util.cancelAnimFrame(this._redrawRequest);
        this._redrawRequest = null;
        this._redrawBounds = null;
        this._draw();
    },

    _draw: function () {
        if (this.failed) return;
        try {
            this.gpu.render(this.scene);
        } catch (error) {
            console.warn("WebGL map rendering failed; using Canvas", error);
            queueMicrotask(() => this.useCanvas());
        }
    },

    _bringToFront: function (layer) {
        L.Canvas.prototype._bringToFront.call(this, layer);
        this.scene.setChildIndex(this.graphics.get(layer).shape, this.scene.children.length - 1);
    },

    _bringToBack: function (layer) {
        L.Canvas.prototype._bringToBack.call(this, layer);
        this.scene.setChildIndex(this.graphics.get(layer).shape, 0);
    },

    loseContext: function (event) {
        event.preventDefault();
        queueMicrotask(() => this.useCanvas());
    },

    useCanvas: function () {
        if (this.failed || !this._map) return;
        this.failed = true;
        const map = this._map;
        const fallback = L.canvas();
        this.fire("fallback", { renderer: fallback });
        for (const layer of Object.values(this._layers)) {
            layer.remove();
            layer.options.renderer = fallback;
            layer.addTo(map);
        }
        map.removeLayer(this);
    },
});

export function createPolygonRenderer() {
    const canvas = document.createElement("canvas");
    const attributes = { alpha: true, antialias: true, stencil: true, failIfMajorPerformanceCaveat: true };
    const context = canvas.getContext("webgl2", attributes) || canvas.getContext("webgl", attributes);
    if (!context) return null;
    try {
        return new WebGLRenderer(createGPU(context));
    } catch (error) {
        context.getExtension("WEBGL_lose_context")?.loseContext();
        console.warn("WebGL map rendering is unavailable; using Canvas", error);
        return null;
    }
}

function createGPU(context) {
    return new Renderer({
        view: context.canvas,
        context,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
    });
}

function styleKey(options) {
    return [
        options.fill,
        options.fillColor,
        options.color,
        options.fillOpacity,
        options.stroke,
        options.weight,
        options.opacity,
        options.lineCap,
        options.lineJoin,
    ].join("|");
}
