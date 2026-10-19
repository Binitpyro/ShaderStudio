#version 300 es
precision highp float;

uniform mat4 u_mvp;
uniform float u_time;
uniform float u_audio_bass;
uniform float u_audio_mid;
uniform float u_audio_treble;
uniform float u_audio_level;
uniform float u_audio_beat;
uniform sampler2D u_audioTexture;

in vec3 v_position;
out vec4 fragColor;

void main() {
  vec2 uv = v_position.xy * 2.0;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float speed = u_time * (0.8 + u_audio_mid * 1.5);
  float tunnelZ = 0.5 / max(0.01, r) + speed;
  vec2 tunnelUv = vec2(a / 3.14159265 * 4.0, tunnelZ);

  float audioVal = texture(u_audioTexture, vec2(fract(tunnelZ * 0.1), 0.25)).r;

  vec2 grid = abs(fract(tunnelUv) - 0.5);
  float line = smoothstep(0.04 + u_audio_treble * 0.05, 0.0, min(grid.x, grid.y));

  vec3 baseColor = mix(
    vec3(0.1, 0.0, 0.3),
    vec3(0.0, 0.8, 1.0),
    sin(tunnelZ * 0.5) * 0.5 + 0.5
  );

  vec3 beatFlash = vec3(1.0, 0.3, 0.6) * u_audio_beat * 1.8;
  float bassPulse = u_audio_bass * 0.7;

  vec3 color = baseColor * (0.2 + audioVal * 1.5) + line * (vec3(0.3, 0.9, 1.0) + beatFlash);
  color += vec3(0.8, 0.2, 0.9) * line * bassPulse;

  color *= smoothstep(0.0, 0.35, r);

  fragColor = vec4(color, 1.0);
}
