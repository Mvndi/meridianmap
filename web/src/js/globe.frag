precision highp float;
varying vec2 uv;
uniform sampler2D mapTexture;
uniform sampler2D iconTexture;
uniform vec2 viewport;
uniform vec2 center;
uniform vec4 bounds;
uniform vec4 projection;
uniform vec4 geography;
uniform float verticalRatio;

float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 space(vec2 pixel, float curve) {
    vec2 cell = floor(pixel / 7.0);
    vec2 offset = vec2(hash(cell), hash(cell + 19.3));
    float star = 1.0 - smoothstep(0.25, 1.1, length(mod(pixel, 7.0) - offset * 7.0));
    star *= step(0.985, hash(cell + 71.7)) * (0.2 + hash(cell + 3.1) * 0.6);
    return (vec3(0.004, 0.006, 0.012) + star * vec3(0.75, 0.82, 1.0)) * curve;
}

float worldZ(float latitude) {
    float offset = geography.z - latitude;
    float discriminant = geography.y * geography.y - 4.0 * geography.x * offset;
    return 2.0 * offset / (-geography.y + sqrt(max(0.0, discriminant)));
}

void main() {
    float curve = projection.x;
    float radius = projection.y;
    float latitude = projection.z;
    float scale = projection.w;
    vec2 pixel = vec2(uv.x, 1.0 - uv.y) * viewport;
    vec2 plane = (pixel - viewport * 0.5) / scale;
    vec2 point = center + plane;
    vec3 background = vec3(0.0);
    vec3 normal = vec3(0.0, 0.0, 1.0);
    float distanceFromCenter = 0.0;
    if (curve > 0.0001) {
        vec2 sphere = vec2(plane.x, -plane.y * mix(verticalRatio, 1.0, curve)) * curve / radius;
        distanceFromCenter = length(sphere);
        if (distanceFromCenter > 1.0) {
            float atmosphere = exp(-(distanceFromCenter - 1.0) * 100.0) * 0.3 * curve;
            gl_FragColor = vec4(space(pixel, curve) + atmosphere * vec3(0.25, 0.45, 0.7), 1.0);
            return;
        }
        normal = vec3(sphere, sqrt(max(0.0, 1.0 - dot(sphere, sphere))));
        float north = normal.y * cos(latitude) + normal.z * sin(latitude);
        float forward = normal.z * cos(latitude) - normal.y * sin(latitude);
        float centerLatitude = geography.x * center.y * center.y + geography.y * center.y + geography.z;
        float mappedZ = worldZ(centerLatitude + (asin(clamp(north, -1.0, 1.0)) - latitude) / curve);
        float tangentZ = worldZ(centerLatitude - plane.y * verticalRatio / radius);
        point = vec2(center.x + atan(normal.x, forward) * radius / curve,
            mappedZ + (1.0 - curve) * (center.y + plane.y - tangentZ));
    }
    vec2 coordinate = (point - bounds.xy) / bounds.zw;
    vec4 terrain = vec4(0.0);
    if (coordinate.x >= 0.0 && coordinate.y >= 0.0 && coordinate.x <= 1.0 && coordinate.y <= 1.0) {
        terrain = texture2D(mapTexture, coordinate);
        vec4 icon = texture2D(iconTexture, coordinate);
        terrain.rgb = mix(terrain.rgb, icon.rgb, icon.a * pow(1.0 - curve, 2.0));
    }
    vec3 uncharted = vec3(0.11, 0.12, 0.135);
    float light = 0.35 + 0.65 * max(0.0, dot(normal, normalize(vec3(-0.35, 0.45, 1.0))));
    vec3 surface = mix(uncharted * curve, terrain.rgb, terrain.a);
    surface *= mix(1.0, light, curve);
    float rim = pow(1.0 - normal.z, 4.0) * curve;
    surface += rim * vec3(0.10, 0.16, 0.24);
    float edge = 1.0 - smoothstep(0.996, 1.0, distanceFromCenter);
    gl_FragColor = vec4(mix(background, surface, edge), 1.0);
}
