#version 300 es
precision highp float;
uniform mat4 u_mvp;
uniform vec3 u_color;
in vec3 a_position;
void main() { gl_Position = u_mvp * vec4(a_position, 1.0); }
