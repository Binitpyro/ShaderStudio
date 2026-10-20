#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_shadowMap;
void main() {
  float d = texture(u_shadowMap, v_uv).r;
  fragColor = vec4(d, d * d, 0.0, 1.0);
}
