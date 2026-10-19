#version 300 es
precision highp float;

in vec3 v_world_pos;
in vec2 v_uv;
in vec3 v_normal;
out vec4 fragColor;

uniform float u_time;
uniform vec3 u_color;
uniform float u_fresnelPower;
uniform float u_iridescence;
uniform float u_roughness;
uniform float u_pulseSpeed;
uniform float u_audio_bass;
uniform float u_audio_mid;
uniform float u_audio_treble;
uniform float u_audio_beat;

vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec3 dX = dFdx(v_world_pos);
    vec3 dY = dFdy(v_world_pos);
    vec3 crossNorm = cross(dX, dY);
    vec3 normal = length(v_normal) > 0.1
        ? normalize(v_normal)
        : (length(crossNorm) > 1e-5 ? normalize(crossNorm) : vec3(0.0, 1.0, 0.0));

    vec3 viewDir = normalize(vec3(0.0, 2.0, 4.0) - v_world_pos);
    if (dot(normal, viewDir) < 0.0) {
        normal = -normal;
    }
    vec3 lightDir = normalize(vec3(1.0, 2.0, 1.5));
    vec3 halfVec = normalize(lightDir + viewDir);

    float NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
    float fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), max(0.1, u_fresnelPower));

    float NdotH = clamp(dot(normal, halfVec), 0.0, 1.0);
    float shininess = mix(128.0, 8.0, clamp(u_roughness, 0.0, 1.0));
    float spec = pow(NdotH, shininess);

    float wavePhase = u_time * u_pulseSpeed * 0.5 + v_world_pos.y * 2.0;
    float thinFilm = pow(clamp(1.0 - NdotV, 0.0, 1.0), 2.0) + sin(wavePhase) * 0.15 + u_audio_mid * 0.3;
    vec3 iridescentCol = palette(thinFilm * u_iridescence);

    float diff = max(0.25, dot(normal, lightDir) * 0.55 + 0.45);

    vec3 base = u_color * diff;
    float audioBoost = 1.0 + u_audio_beat * 0.5;
    vec3 rgb = (mix(base, iridescentCol, 0.65) + vec3(spec * 1.8) + iridescentCol * fresnel * 1.6) * audioBoost;

    fragColor = vec4(rgb, 1.0);
}
