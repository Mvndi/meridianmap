import { EARTH_PROJECTION, earthCoordinates, earthZ } from "./util/Geography.js";

export const RADIANS = Math.PI / 180;

export function validateGlobe(settings) {
    const { bounds, startZoom, globeZoom, minZoom } = settings;
    const values = [bounds?.minX, bounds?.maxX, bounds?.minZ, bounds?.maxZ, startZoom, globeZoom, minZoom];
    if (!values.every(Number.isFinite)) throw new Error("Invalid globe configuration");
    if (
        bounds.minX >= bounds.maxX ||
        bounds.minZ >= bounds.maxZ ||
        minZoom > globeZoom ||
        globeZoom >= startZoom ||
        startZoom > 3 ||
        minZoom < -6 ||
        bounds.maxX - bounds.minX > 100000 ||
        bounds.maxZ - bounds.minZ > 100000
    ) {
        throw new Error("Globe configuration is outside its allowed range");
    }
    return settings;
}

export function globeView(settings, center, zoom, scale) {
    const progress = Math.max(0, Math.min(1, (settings.startZoom - zoom) / (settings.startZoom - settings.globeZoom)));
    const curve = progress * progress * (3 - 2 * progress);
    const radius = 1 / (EARTH_PROJECTION.longitudeScale * RADIANS);
    const latitude = Math.max(-85, Math.min(85, earthCoordinates(center.x, center.y).latitude)) * RADIANS;
    const slope = Math.abs(2 * EARTH_PROJECTION.latitudeQuadratic * center.y + EARTH_PROJECTION.latitudeLinear);
    const verticalRatio = slope / EARTH_PROJECTION.longitudeScale;
    return { curve, radius, latitude: latitude * curve, verticalRatio, pixelsPerBlock: scale * 2 ** zoom };
}

export function globePoint(view, center, pixel, size) {
    const plane = { x: (pixel.x - size.x / 2) / view.pixelsPerBlock, y: (pixel.y - size.y / 2) / view.pixelsPerBlock };
    if (view.curve <= 0.0001) return { x: center.x + plane.x, y: center.y + plane.y };
    const sphereX = (plane.x * view.curve) / view.radius;
    const sphereY = ((-plane.y * view.curve) / view.radius) * (view.verticalRatio * (1 - view.curve) + view.curve);
    const distance = sphereX ** 2 + sphereY ** 2;
    if (distance > 1) return;
    const sphereZ = Math.sqrt(1 - distance);
    const north = sphereY * Math.cos(view.latitude) + sphereZ * Math.sin(view.latitude);
    const forward = sphereZ * Math.cos(view.latitude) - sphereY * Math.sin(view.latitude);
    const latitude = earthCoordinates(center.x, center.y).latitude;
    const mappedZ = earthZ(
        latitude + (Math.asin(Math.max(-1, Math.min(1, north))) - view.latitude) / view.curve / RADIANS,
    );
    const tangentZ = earthZ(latitude - (plane.y * view.verticalRatio) / view.radius / RADIANS);
    return {
        x: center.x + (Math.atan2(sphereX, forward) * view.radius) / view.curve,
        y: mappedZ + (1 - view.curve) * (center.y + plane.y - tangentZ),
    };
}
