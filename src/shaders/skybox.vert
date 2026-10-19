#version 300 es
precision highp float;

out vec2 v_clipCoord;

void main() {
  float x = float((gl_VertexID & 1) * 4 - 1);
  float y = float((gl_VertexID & 2) * 2 - 1);
  v_clipCoord = vec2(x, y);
  gl_Position = vec4(x, y, 1.0, 1.0);
}
