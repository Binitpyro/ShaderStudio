#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform vec2 u_resolution;
uniform float u_focalDistance;
uniform float u_aperture;
uniform float u_maxBlur;
uniform float u_bokehShape; // 0 circle, 1 hexagon, 2 octagon
uniform float u_near;
uniform float u_far;
void main() {
  vec4 center = texture(u_texture, v_uv);
  float d = texture(u_depthTexture, v_uv).r;
  float z = (u_near * u_far) / (u_far - d * (u_far - u_near));
  float coc = clamp(abs(z - u_focalDistance) / max(z, 0.001) * u_aperture * 100.0, 0.0, u_maxBlur);
  if (coc < 0.5) { fragColor = center; return; }
  vec2 texel = 1.0 / u_resolution;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 24; i++) {
    float theta = float(i) * 2.3999632;
    float r = sqrt(float(i + 1) / 24.0) * coc;
    if (u_bokehShape > 0.5) {
      float n = u_bokehShape > 1.5 ? 8.0 : 6.0;
      float piN = 3.14159265 / n;
      r *= cos(piN) / cos(mod(theta, 2.0 * piN) - piN);
    }
    vec4 c = texture(u_texture, v_uv + vec2(cos(theta), sin(theta)) * r * texel);
    float w = 1.0 + pow(max(0.0, dot(c.rgb, vec3(0.299, 0.587, 0.114)) - 0.7), 2.0) * 4.0;
    acc += c * w;
    wsum += w;
  }
  fragColor = acc / max(wsum, 0.001);
}
