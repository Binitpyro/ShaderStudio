#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_mvp;       // jittered when TAA is on (drives rasterisation)
uniform mat4 u_mvpUnjit;  // current frame, no jitter (drives motion vectors)
uniform mat4 u_prevMvp;   // previous frame, no jitter
uniform mat4 u_model;
out vec3 v_world;
out vec4 v_cur;
out vec4 v_prev;
void main() {
  vec4 p = vec4(a_position, 1.0);
  v_world = (u_model * p).xyz;
  v_cur = u_mvpUnjit * p;
  v_prev = u_prevMvp * p;
  gl_Position = u_mvp * p;
}
