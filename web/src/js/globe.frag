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
uniform float elapsedTime;

const int CLOUD_STEPS = 18;
const float CLOUD_BOTTOM = 0.065;
const float CLOUD_TOP = 0.23;
const vec3 SUN = vec3(-0.35, 0.45, 1.0);

float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float cloudHash(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.yzx + 33.33);
    return fract((point.x + point.y) * point.z);
}

float cloudNoise(vec3 point) {
    vec3 cell = floor(point);
    vec3 blend = fract(point);
    blend = blend * blend * (3.0 - 2.0 * blend);
    float near = mix(
        mix(cloudHash(cell), cloudHash(cell + vec3(1.0, 0.0, 0.0)), blend.x),
        mix(cloudHash(cell + vec3(0.0, 1.0, 0.0)), cloudHash(cell + vec3(1.0, 1.0, 0.0)), blend.x),
        blend.y);
    float far = mix(
        mix(cloudHash(cell + vec3(0.0, 0.0, 1.0)), cloudHash(cell + vec3(1.0, 0.0, 1.0)), blend.x),
        mix(cloudHash(cell + vec3(0.0, 1.0, 1.0)), cloudHash(cell + vec3(1.0, 1.0, 1.0)), blend.x),
        blend.y);
    return mix(near, far, blend.z);
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

mat3 cloudRotation() {
    float longitude = center.x / projection.y;
    float latitude = projection.z;
    return mat3(
        -sin(longitude), 0.0, cos(longitude),
        -sin(latitude) * cos(longitude), cos(latitude), -sin(latitude) * sin(longitude),
        cos(latitude) * cos(longitude), sin(latitude), cos(latitude) * sin(longitude));
}

float cloudDensity(vec3 position, float lift) {
    float height = (length(position) - 1.0) / lift;
    if (height < CLOUD_BOTTOM || height > CLOUD_TOP) return 0.0;
    vec3 wind = elapsedTime * vec3(0.004, 0.001, 0.002);
    float billows = cloudNoise(position * 6.0 + wind);
    float detail = cloudNoise(position * 18.0 - wind * 1.3);
    float weather = billows * 0.75 + detail * 0.25;
    float top = mix(0.17, CLOUD_TOP, smoothstep(0.2, 0.8, weather));
    float envelope = smoothstep(CLOUD_BOTTOM, CLOUD_BOTTOM + 0.025, height)
        * (1.0 - smoothstep(top - 0.045, top, height));
    return mix(0.7, 1.0, weather) * envelope;
}

float fogParticles(vec3 position) {
    vec3 cell = floor(position);
    vec3 offset = vec3(cloudHash(cell), cloudHash(cell + 19.0), cloudHash(cell + 47.0));
    vec3 displacement = fract(position) - offset;
    return exp(-dot(displacement, displacement) * 120.0) * step(0.8, cloudHash(cell + 71.0));
}

vec4 cloudLayer(vec2 disk, mat3 rotation) {
    float lift = projection.x * projection.x;
    float outer = 1.0 + CLOUD_TOP * lift;
    float distanceSquared = dot(disk, disk);
    if (projection.x < 0.03 || distanceSquared >= outer * outer) return vec4(0.0);
    float front = sqrt(outer * outer - distanceSquared);
    float inner = 1.0 + CLOUD_BOTTOM * lift;
    float back = distanceSquared < inner * inner ? sqrt(inner * inner - distanceSquared) : -front;
    float stepLength = (front - back) / float(CLOUD_STEPS);
    vec4 cloud = vec4(0.0);
    for (int index = 0; index < CLOUD_STEPS; index++) {
        vec3 point = vec3(disk, front - (float(index) + 0.5) * stepLength);
        float density = cloudDensity(rotation * point, lift);
        float opacity = 1.0 - exp(-density * stepLength * 150.0 / max(lift, 0.1));
        float height = clamp(((length(point) - 1.0) / lift - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM), 0.0, 1.0);
        float light = 0.35 + height * 0.5 + max(0.0, dot(normalize(point), normalize(SUN))) * 0.1 - density * 0.15;
        vec3 color = mix(vec3(0.32, 0.38, 0.47), vec3(0.98, 0.99, 1.0), light);
        color += fogParticles(rotation * point * 55.0 - elapsedTime * 0.01) * 0.15;
        cloud.rgb += (1.0 - cloud.a) * opacity * color;
        cloud.a += (1.0 - cloud.a) * opacity;
        if (cloud.a > 0.9995) break;
    }
    return cloud * projection.x;
}

void main() {
    float curve = projection.x;
    float radius = projection.y;
    float latitude = projection.z;
    float scale = projection.w;
    vec2 pixel = vec2(uv.x, 1.0 - uv.y) * viewport;
    vec2 plane = (pixel - viewport * 0.5) / scale;
    vec2 disk = vec2(plane.x, -plane.y * mix(verticalRatio, 1.0, curve)) * curve / radius;
    float distanceFromCenter = length(disk);
    float outer = 1.0 + CLOUD_TOP * curve * curve;
    vec3 scene = space(pixel, curve);
    float atmosphere = exp(-max(0.0, distanceFromCenter - 1.0) * 100.0) * 0.3 * curve;
    if (distanceFromCenter > 1.0) scene += atmosphere * vec3(0.25, 0.45, 0.7);
    if (distanceFromCenter > outer) {
        gl_FragColor = vec4(scene, 1.0);
        return;
    }
    mat3 rotation = cloudRotation();
    if (distanceFromCenter <= 1.0) {
        vec3 normal = vec3(disk, sqrt(max(0.0, 1.0 - dot(disk, disk))));
        vec2 point = center + plane;
        if (curve > 0.0001) {
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
        float light = 0.35 + 0.65 * max(0.0, dot(normal, normalize(SUN)));
        vec3 surface = mix(vec3(0.11, 0.12, 0.135) * curve, terrain.rgb, terrain.a);
        surface *= mix(1.0, light, curve);
        if (curve > 0.03) {
            float lift = curve * curve;
            vec3 shadow = rotation * (normal * (1.0 + 0.14 * lift) + normalize(SUN) * 0.045 * lift);
            surface *= 1.0 - cloudDensity(shadow, lift) * 0.4 * curve;
        }
        surface += pow(1.0 - normal.z, 4.0) * curve * vec3(0.10, 0.16, 0.24);
        float edge = 1.0 - smoothstep(0.996, 1.0, distanceFromCenter);
        scene = mix(scene, surface, edge);
    }
    vec4 cloud = cloudLayer(disk, rotation);
    gl_FragColor = vec4(scene * (1.0 - cloud.a) + cloud.rgb, 1.0);
}
