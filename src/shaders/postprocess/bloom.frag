#version 300 es

precision highp float;

uniform sampler2D u_texture;
uniform float u_bloomThreshold;
uniform float u_bloomIntensity;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 baseColor = texture(u_texture, v_texCoord);
  float stepSize = 0.004;

  vec3 glow = max(baseColor.rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(-stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(stepSize, 0.0)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(0.0, -stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));
  glow += max(texture(u_texture, v_texCoord + vec2(0.0, stepSize)).rgb - vec3(u_bloomThreshold), vec3(0.0));

  glow = (glow / 5.0) * u_bloomIntensity;

  fragColor = vec4(baseColor.rgb + glow, baseColor.a);
}
