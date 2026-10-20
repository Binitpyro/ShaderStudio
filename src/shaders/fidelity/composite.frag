#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform sampler2D u_aoTex;
uniform float u_aoStrength; // 0 = plain copy
void main() {
  vec4 c = texture(u_texture, v_uv);
  fragColor = vec4(c.rgb * mix(1.0, texture(u_aoTex, v_uv).r, u_aoStrength), c.a);
}
