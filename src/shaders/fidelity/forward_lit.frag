#version 300 es
precision highp float;
in vec3 v_world;
out vec4 fragColor;
uniform vec3 u_color;
uniform float u_roughness;
uniform float u_metallic;
//#include env
//#include shadow
//#include lighting
void main() {
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  if (dot(n, u_camPos - v_world) < 0.0) n = -n;
  fragColor = vec4(shade(u_color, v_world, n, u_roughness, u_metallic, 1.0), 1.0);
}
