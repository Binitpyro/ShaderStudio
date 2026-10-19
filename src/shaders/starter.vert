#version 300 es
layout(location = 0) in vec3 a_position;

uniform mat4 u_mvp;
uniform float u_time;
uniform float u_pulseSpeed;
uniform float u_audio_bass;

out vec3 v_world_pos;
out vec2 v_uv;
out vec3 v_normal;

void main() {
    float pulse = sin(u_time * u_pulseSpeed * 2.0) * 0.04 * (1.0 + u_audio_bass * 1.8);
    vec3 displacedPos = a_position * (1.0 + pulse);

    gl_Position = u_mvp * vec4(displacedPos, 1.0);
    v_world_pos = displacedPos;
    v_normal = vec3(0.0);
    v_uv = vec2(
        atan(a_position.z, a_position.x) / 6.2831853 + 0.5,
        a_position.y * 0.5 + 0.5
    );
}
