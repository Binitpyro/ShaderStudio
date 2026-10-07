#version 300 es

precision highp float;

uniform sampler2D u_texture;
uniform float u_aberrationOffset;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 uv = v_texCoord;
  vec2 dir = uv - vec2(0.5);
  float dist = length(dir);
  vec2 offset = (dist > 0.0001) ? (dir / dist) * u_aberrationOffset : vec2(u_aberrationOffset, 0.0);

  float r = texture(u_texture, uv + offset).r;
  float g = texture(u_texture, uv).g;
  float b = texture(u_texture, uv - offset).b;
  float a = texture(u_texture, uv).a;

  fragColor = vec4(r, g, b, a);
}
