import L from "leaflet";
import { globePoint, globeView, RADIANS, validateGlobe } from "./GlobeProjection.js";
import { EARTH_PROJECTION } from "./util/Geography.js";
import vertexSource from "./globe.vert?raw";
import fragmentSource from "./globe.frag?raw";

const TILE_SIZE = 512;
const ATLAS_ZOOM = 1;
const MAX_RESOLUTION = 2;
const ZOOM_DURATION = 250;

export class GlobeView {
    constructor(app, settings) {
        this.app = app;
        this.map = app.map;
        this.settings = validateGlobe(settings);
        this.originalOptions = {
            scrollWheelZoom: this.map.options.scrollWheelZoom,
            touchZoom: this.map.options.touchZoom,
            doubleClickZoom: this.map.options.doubleClickZoom,
            zoomSnap: this.map.options.zoomSnap,
        };
        this.canvas = document.createElement("canvas");
        this.canvas.className = "m-globe";
        this.canvas.setAttribute("aria-hidden", "true");
        this.gl = this.canvas.getContext("webgl", { alpha: false, antialias: false });
        if (!this.gl) throw new Error("WebGL is unavailable");
        try {
            this.initializeGPU();
        } catch (error) {
            this.gl.getExtension("WEBGL_lose_context")?.loseContext();
            throw error;
        }
        this.canvas.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            this.destroy();
        });
        this.map.getContainer().prepend(this.canvas);
        this.refresh = this.refresh.bind(this);
        this.animateZoom = this.animateZoom.bind(this);
        this.openMap = this.openMap.bind(this);
        this.map.on("move zoom resize layeradd layerremove", this.refresh);
        this.map.on("zoomanim", this.animateZoom);
        this.map.on("dblclick", this.openMap);
        this.map.on("unload", this.destroy, this);
        this.refreshTimer = setInterval(() => {
            if (document.visibilityState === "visible" && this.map.getZoom() <= this.settings.startZoom + 1) {
                this.refreshAtlas();
            }
        }, 15000);
        this.overlayTimer = setInterval(() => this.updateOverlay(), 1000);
    }

    initializeGPU() {
        const gl = this.gl;
        const shaders = [
            [gl.VERTEX_SHADER, vertexSource],
            [gl.FRAGMENT_SHADER, fragmentSource],
        ];
        this.program = gl.createProgram();
        for (const [type, source] of shaders) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(this.program, shader);
            gl.deleteShader(shader);
        }
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
        gl.useProgram(this.program);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(this.program, "position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        this.uniforms = new Map();
        this.texture = this.createTexture(gl.TEXTURE0);
        this.iconTexture = this.createTexture(gl.TEXTURE1);
        gl.uniform1i(gl.getUniformLocation(this.program, "iconTexture"), 1);
    }

    createTexture(unit) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.activeTexture(unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }

    async setWorld(world) {
        if (this.destroyed) return;
        this.generation = (this.generation ?? 0) + 1;
        this.world = world;
        this.ready = false;
        this.tiles = new Map();
        this.loading = false;
        this.setActive(false);
        this.map.options.zoomSnap = this.originalOptions.zoomSnap;
        this.map.setMinZoom(0);
        if (world.name !== this.settings.world) return;
        const { bounds } = this.settings;
        const scale = (this.atlasScale = this.app.scale * 2 ** ATLAS_ZOOM);
        const width = Math.ceil((bounds.maxX - bounds.minX) * scale);
        const height = Math.ceil((bounds.maxZ - bounds.minZ) * scale);
        if (Math.max(width, height) > this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) return;
        this.terrain = Object.assign(document.createElement("canvas"), { width, height });
        this.atlas = Object.assign(document.createElement("canvas"), { width, height });
        this.icons = Object.assign(document.createElement("canvas"), { width, height });
        await this.refreshAtlas();
    }

    async refreshAtlas() {
        if (!this.terrain || this.loading || this.destroyed || this.world?.name !== this.settings.world) return;
        this.loading = true;
        const generation = this.generation;
        const { bounds } = this.settings;
        const tasks = [];
        for (
            let x = Math.floor((bounds.minX * this.atlasScale) / TILE_SIZE);
            x < (bounds.maxX * this.atlasScale) / TILE_SIZE;
            x++
        ) {
            for (
                let y = Math.floor((bounds.minZ * this.atlasScale) / TILE_SIZE);
                y < (bounds.maxZ * this.atlasScale) / TILE_SIZE;
                y++
            ) {
                tasks.push(this.loadTile(x, y, generation));
            }
        }
        await Promise.allSettled(tasks);
        if (generation !== this.generation || this.destroyed) return;
        this.loading = false;
        if (!this.tiles.size) return;
        this.ready = true;
        this.map.options.zoomSnap = 0.25;
        this.map.setMinZoom(this.settings.minZoom);
        this.updateOverlay(true);
        this.restoreRequestedView();
    }

    async loadTile(x, y, generation) {
        const urls = [`tiles/${this.world.name}/${ATLAS_ZOOM}/${x}_${y}.png`];
        if (this.world.relief?.enabled) urls.push(`tiles/${this.world.name}/relief/${ATLAS_ZOOM}/${x}_${y}.png`);
        const results = await Promise.allSettled(urls.map((url) => this.loadImage(url)));
        if (results[0].status !== "fulfilled") return;
        const previous = this.tiles.get(`${x}_${y}`);
        const images = results.map((result, index) =>
            result.status === "fulfilled" ? result.value : previous?.images[index],
        );
        if (generation === this.generation && !this.destroyed) this.tiles.set(`${x}_${y}`, { x, y, images });
    }

    async loadImage(url) {
        const response = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Globe tile request failed: ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        try {
            const image = new Image();
            image.src = objectUrl;
            await image.decode();
            return image;
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    drawTerrain() {
        const context = this.terrain.getContext("2d");
        context.clearRect(0, 0, this.terrain.width, this.terrain.height);
        const relief = this.app.layerControl.reliefLayer;
        const showRelief = relief && this.map.hasLayer(relief);
        for (const { x, y, images } of this.tiles.values()) {
            const left = x * TILE_SIZE - this.settings.bounds.minX * this.atlasScale;
            const top = y * TILE_SIZE - this.settings.bounds.minZ * this.atlasScale;
            context.drawImage(images[0], left, top);
            if (!showRelief || !images[1]) continue;
            context.globalCompositeOperation = this.world.relief.blend_mode || "hard-light";
            context.globalAlpha = this.world.relief.opacity ?? 1;
            context.drawImage(images[1], left, top);
            context.globalCompositeOperation = "source-over";
            context.globalAlpha = 1;
        }
    }

    updateOverlay(force = false) {
        if (
            !this.ready ||
            this.destroyed ||
            (!force && (document.visibilityState !== "visible" || this.map.getZoom() > this.settings.startZoom + 1))
        )
            return;
        this.drawTerrain();
        const context = this.atlas.getContext("2d");
        const icons = this.icons.getContext("2d");
        context.clearRect(0, 0, this.atlas.width, this.atlas.height);
        icons.clearRect(0, 0, this.icons.width, this.icons.height);
        context.drawImage(this.terrain, 0, 0);
        this.map.eachLayer((layer) => {
            if (layer instanceof L.Polyline || layer instanceof L.Circle || layer instanceof L.Ellipse) {
                this.drawPath(context, layer);
            }
            if (layer instanceof L.Marker) this.drawIcon(icons, layer);
        });
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.iconTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.icons);
        this.refresh();
    }

    drawPath(context, layer) {
        const options = layer.options;
        context.beginPath();
        if (layer.getLatLngs) this.drawRings(context, layer.getLatLngs(), layer instanceof L.Polygon);
        else this.drawEllipse(context, layer);
        context.globalAlpha = options.fillOpacity ?? 0.2;
        context.fillStyle = options.fillColor || options.color;
        if (options.fill) context.fill(options.fillRule || "evenodd");
        context.globalAlpha = options.opacity ?? 1;
        context.strokeStyle = options.color;
        context.lineWidth = (options.weight ?? 3) * 2 ** (ATLAS_ZOOM - this.settings.startZoom);
        context.lineJoin = options.lineJoin || "round";
        context.lineCap = options.lineCap || "round";
        const dash = String(options.dashArray || "")
            .split(/[ ,]+/)
            .map(Number)
            .filter((value) => value > 0);
        context.setLineDash(dash);
        if (options.stroke) context.stroke();
        context.globalAlpha = 1;
    }

    drawRings(context, points, closed) {
        if (!points.length) return;
        if (Array.isArray(points[0])) {
            for (const ring of points) this.drawRings(context, ring, closed);
            return;
        }
        points.forEach((latlng, index) => {
            const point = this.app.toPoint(latlng);
            const x = (point.x - this.settings.bounds.minX) * this.atlasScale;
            const y = (point.y - this.settings.bounds.minZ) * this.atlasScale;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        if (closed) context.closePath();
    }

    drawEllipse(context, layer) {
        const point = this.app.toPoint(layer.getLatLng());
        const radius = layer.getRadius();
        const radii = typeof radius === "number" ? L.point(radius, radius) : radius;
        const scale = 2 ** ATLAS_ZOOM;
        context.ellipse(
            (point.x - this.settings.bounds.minX) * this.atlasScale,
            (point.y - this.settings.bounds.minZ) * this.atlasScale,
            radii.x * scale,
            radii.y * scale,
            (layer._tiltDeg || 0) * RADIANS,
            0,
            Math.PI * 2,
        );
    }

    drawIcon(context, layer) {
        const element = layer.getElement();
        const image = element instanceof HTMLImageElement ? element : element?.querySelector("img");
        if (!image?.complete || !image.naturalWidth || new URL(image.src).origin !== location.origin) return;
        const icon = layer.options.icon.options;
        const size = L.point(icon.iconSize || [image.width, image.height]);
        const anchor = L.point(icon.iconAnchor || size.divideBy(2));
        const point = this.app.toPoint(layer.getLatLng());
        const scale = 2 ** (ATLAS_ZOOM - this.settings.startZoom);
        context.save();
        context.translate(
            (point.x - this.settings.bounds.minX) * this.atlasScale,
            (point.y - this.settings.bounds.minZ) * this.atlasScale,
        );
        context.rotate((layer.options.rotationAngle || 0) * RADIANS);
        context.globalAlpha = layer.options.opacity ?? 1;
        context.drawImage(image, -anchor.x * scale, -anchor.y * scale, size.x * scale, size.y * scale);
        context.restore();
    }

    setActive(active) {
        this.active = active;
        this.map.getContainer().classList.toggle("m-globe-active", active);
        for (const key of ["scrollWheelZoom", "touchZoom", "doubleClickZoom"]) {
            this.map.options[key] = active ? "center" : this.originalOptions[key];
        }
    }

    toPoint(pixel) {
        if (!this.active) return;
        const center = this.app.toPoint(this.visualCenter);
        const view = globeView(this.settings, center, this.visualZoom, this.app.scale);
        const point = globePoint(view, center, pixel, this.map.getSize());
        const bounds = this.settings.bounds;
        if (
            point &&
            point.x >= bounds.minX &&
            point.x <= bounds.maxX &&
            point.y >= bounds.minZ &&
            point.y <= bounds.maxZ
        )
            return point;
    }

    openMap(event) {
        if (!this.active) return;
        const point = this.toPoint(event.containerPoint);
        if (point) this.app.centerOn(point.x, point.y, this.settings.startZoom + 1);
    }

    restoreRequestedView() {
        const request = this.app.globeRequest;
        if (!this.ready || !request || this.map.getZoom() !== 0) return;
        const center = this.app.toPoint(this.map.getCenter());
        if (Math.abs(center.x - request.x) < 1 && Math.abs(center.y - request.z) < 1) {
            this.app.centerOn(request.x, request.z, request.zoom);
        }
    }

    refresh() {
        if (this.destroyed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.render();
        });
    }

    animateZoom(event) {
        if (!this.ready) return;
        this.animation = {
            fromZoom: this.visualZoom ?? this.map.getZoom(),
            fromCenter: this.visualCenter ?? this.map.getCenter(),
            toZoom: event.zoom,
            toCenter: event.center,
        };
        this.refresh();
    }

    render() {
        if (!this.ready) return;
        this.updateView();
        const active = this.visualZoom < this.settings.startZoom;
        this.setActive(active);
        if (!active) return;
        const size = this.map.getSize();
        const resolution = Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION);
        const width = Math.round(size.x * resolution);
        const height = Math.round(size.y * resolution);
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        const center = this.app.toPoint(this.visualCenter);
        const view = globeView(this.settings, center, this.visualZoom, this.app.scale);
        this.uniform("viewport", size.x, size.y);
        this.uniform("center", center.x, center.y);
        this.uniform(
            "bounds",
            this.settings.bounds.minX,
            this.settings.bounds.minZ,
            this.settings.bounds.maxX - this.settings.bounds.minX,
            this.settings.bounds.maxZ - this.settings.bounds.minZ,
        );
        this.uniform("projection", view.curve, view.radius, view.latitude, view.pixelsPerBlock);
        this.uniform("verticalRatio", view.verticalRatio);
        this.uniform(
            "geography",
            EARTH_PROJECTION.latitudeQuadratic * RADIANS,
            EARTH_PROJECTION.latitudeLinear * RADIANS,
            EARTH_PROJECTION.latitudeOffset * RADIANS,
            0,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    updateView() {
        const animation = this.animation;
        if (!animation) {
            this.visualZoom = this.map.getZoom();
            this.visualCenter = this.map.getCenter();
            return;
        }
        animation.start ??= performance.now();
        const progress = Math.min(1, (performance.now() - animation.start) / ZOOM_DURATION);
        const ease = 1 - (1 - progress) ** 3;
        this.visualZoom = animation.fromZoom + (animation.toZoom - animation.fromZoom) * ease;
        this.visualCenter = L.latLng(
            animation.fromCenter.lat + (animation.toCenter.lat - animation.fromCenter.lat) * ease,
            animation.fromCenter.lng + (animation.toCenter.lng - animation.fromCenter.lng) * ease,
        );
        if (progress === 1) this.animation = undefined;
        else this.refresh();
    }

    uniform(name, ...values) {
        if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
        this.gl[`uniform${values.length}f`](this.uniforms.get(name), ...values);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ready = false;
        cancelAnimationFrame(this.frame);
        clearInterval(this.refreshTimer);
        clearInterval(this.overlayTimer);
        this.map.off("move zoom resize layeradd layerremove", this.refresh);
        this.map.off("zoomanim", this.animateZoom);
        this.map.off("dblclick", this.openMap);
        this.map.off("unload", this.destroy, this);
        this.setActive(false);
        this.map.options.zoomSnap = this.originalOptions.zoomSnap;
        this.canvas.remove();
        this.gl.deleteTexture(this.texture);
        this.gl.deleteTexture(this.iconTexture);
        this.gl.deleteBuffer(this.buffer);
        this.gl.deleteProgram(this.program);
        this.map.setMinZoom(0);
        if (this.map.getZoom() < 0) this.map.setZoom(0, { animate: false });
    }
}

export async function createGlobe(app) {
    let globe;
    try {
        const response = await fetch("globe.json");
        if (!response.ok) return;
        const settings = await response.json();
        if (!settings.enabled) return;
        globe = new GlobeView(app, settings);
        app.globe = globe;
        return globe;
    } catch (error) {
        globe?.destroy();
        console.warn("Globe view is unavailable; using the flat map", error);
    }
}
