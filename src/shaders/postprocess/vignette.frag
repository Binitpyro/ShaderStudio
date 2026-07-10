#version 300 es

precision highp float;

uniform sampler2D u_texture;
uniform float u_vignetteIntensity;
uniform float u_vignetteRadius;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_texture, v_texCoord);

  vec2 uv = v_texCoord * 2.0 - 1.0;
  float dist = length(uv);
  float vignette = smoothstep(u_vignetteRadius, u_vignetteRadius - 0.3, dist);
  vignette = mix(1.0, vignette, u_vignetteIntensity);

  fragColor = vec4(color.rgb * vignette, color.a);
}
