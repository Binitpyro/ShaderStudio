#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_world;
void main() {
  vec4 p = vec4(a_position, 1.0);
  v_world = (u_model * p).xyz;
  gl_Position = u_mvp * p;
}
