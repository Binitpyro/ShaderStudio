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
  float dist = length(uv);
  float angle = atan(uv.y, uv.x);
  float normAngle = (angle + 3.14159265) / (2.0 * 3.14159265);

  float freqCoord = abs(normAngle - 0.5) * 2.0;
  float freqSample = texture(u_audioTexture, vec2(freqCoord, 0.25)).r;
  float waveSample = texture(u_audioTexture, vec2(normAngle, 0.75)).r;

  float baseRadius = 0.35 + u_audio_bass * 0.12 + u_audio_beat * 0.08;
  float barHeight = freqSample * 0.45;
  float targetRadius = baseRadius + barHeight;

  vec3 color = vec3(0.02, 0.03, 0.06);

  if (dist > baseRadius && dist < targetRadius) {
    float t = (dist - baseRadius) / max(0.01, barHeight);
    vec3 barColor = mix(vec3(0.0, 0.8, 0.9), vec3(1.0, 0.1, 0.6), t);
    color += barColor * (1.2 + u_audio_beat * 0.5);
  }

  float ringDist = abs(dist - (0.2 + (waveSample - 0.5) * 0.25));
  float ringGlow = 0.006 / (ringDist + 0.005);
  color += vec3(0.3, 1.0, 0.5) * ringGlow;

  float coreGlow = (1.0 - smoothstep(0.0, 0.25, dist)) * (u_audio_bass * 1.5 + u_audio_beat * 2.5);
  color += vec3(1.0, 0.9, 0.4) * coreGlow * 0.6;

  color *= (1.0 - smoothstep(0.8, 1.4, dist));

  fragColor = vec4(color, 1.0);
}
