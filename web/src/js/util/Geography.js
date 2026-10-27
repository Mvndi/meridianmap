// shortcut: Duke of Lorraine's fitted Earth coordinates, replace when the original projection is available.
export const EARTH_PROJECTION = {
    longitudeScale: 1.797e-3,
    longitudeOffset: -179.04,
    latitudeQuadratic: -5.85e-9,
    latitudeLinear: -1.149e-3,
    latitudeOffset: 82.94,
};

export function earthCoordinates(x, z) {
    const projection = EARTH_PROJECTION;
    return {
        latitude: projection.latitudeQuadratic * z ** 2 + projection.latitudeLinear * z + projection.latitudeOffset,
        longitude: projection.longitudeScale * x + projection.longitudeOffset,
    };
}

export function earthZ(latitude) {
    const projection = EARTH_PROJECTION;
    const offset = projection.latitudeOffset - latitude;
    const discriminant = projection.latitudeLinear ** 2 - 4 * projection.latitudeQuadratic * offset;
    return (2 * offset) / (-projection.latitudeLinear + Math.sqrt(Math.max(0, discriminant)));
}
