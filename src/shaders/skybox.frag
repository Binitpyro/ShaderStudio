#version 300 es
precision highp float;

in vec2 v_clipCoord;
out vec4 fragColor;

uniform sampler2D u_envMap;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform float u_rotation;
uniform float u_blur;
uniform float u_exposure;

const float PI = 3.141592653589793;

void main() {
  vec3 rayDir = normalize(u_camForward + v_clipCoord.x * u_camRight + v_clipCoord.y * u_camUp);

  float phi = acos(clamp(rayDir.y, -1.0, 1.0));
  float v = 1.0 - (phi / PI);

  float theta = atan(rayDir.x, -rayDir.z) + u_rotation;
  float uCoord = (theta / (2.0 * PI)) + 0.5;
  uCoord = fract(uCoord);

  vec2 uv = vec2(uCoord, v);
  vec3 col;

  if (u_blur > 0.01) {
    float off = u_blur * 0.02;
    col = (
      texture(u_envMap, uv).rgb * 2.0 +
      texture(u_envMap, uv + vec2(off, 0.0)).rgb +
      texture(u_envMap, uv - vec2(off, 0.0)).rgb +
      texture(u_envMap, uv + vec2(0.0, off)).rgb +
      texture(u_envMap, uv - vec2(0.0, off)).rgb +
      texture(u_envMap, uv + vec2(off * 0.7, off * 0.7)).rgb +
      texture(u_envMap, uv - vec2(off * 0.7, off * 0.7)).rgb +
      texture(u_envMap, uv + vec2(-off * 0.7, off * 0.7)).rgb +
      texture(u_envMap, uv + vec2(off * 0.7, -off * 0.7)).rgb
    ) / 10.0;
  } else {
    col = texture(u_envMap, uv).rgb;
  }

  fragColor = vec4(col * u_exposure, 1.0);
}
